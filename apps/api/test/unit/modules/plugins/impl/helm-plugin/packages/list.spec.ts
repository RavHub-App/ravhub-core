/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

import { initPackages } from 'src/modules/plugins/impl/helm-plugin/packages/list';
import { Repository } from 'src/plugins-core/plugin.interface';
import * as yaml from 'js-yaml';

jest.mock('src/modules/plugins/impl/helm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('HelmPlugin Packages', () => {
  let mockStorage: any;
  let mockGetRepo: jest.Mock;
  let packageMethods: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
    };
    mockGetRepo = jest.fn();
    packageMethods = initPackages({ storage: mockStorage, getRepo: mockGetRepo } as any);
    jest.clearAllMocks();
  });

  describe('listVersions', () => {
    it('should list versions from index.yaml', async () => {
      const indexYaml = yaml.dump({
        entries: {
          'my-chart': [{ version: '1.0.0' }, { version: '2.0.0' }],
        },
      });
      mockStorage.get.mockResolvedValue(Buffer.from(indexYaml));

      const repo: Repository = { id: 'r1', name: 'helm-repo' } as any;
      const result = await packageMethods.listVersions(repo, 'my-chart');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('2.0.0');
    });

    it('should return empty array when chart not found', async () => {
      mockStorage.get.mockResolvedValue(null);

      const repo: Repository = { id: 'r1', name: 'helm-repo' } as any;
      const result = await packageMethods.listVersions(repo, 'missing-chart');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual([]);
    });

    it('should list versions from cached proxy index.yaml', async () => {
      const indexYaml = yaml.dump({
        entries: {
          'my-chart': [{ version: '3.1.4' }],
        },
      });

      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'helm/r1/proxy/file/index.yaml') {
          return Buffer.from(indexYaml);
        }
        return null;
      });

      const repo: Repository = {
        id: 'r1',
        name: 'helm-proxy',
        type: 'proxy',
      } as any;
      const result = await packageMethods.listVersions(repo, 'my-chart');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['3.1.4']);
    });
  });

  describe('listPackages', () => {
    it('should list charts with their latest version from index.yaml', async () => {
      const indexYaml = yaml.dump({
        entries: {
          ravhub: [
            { version: '0.1.0', created: '2026-04-01T10:00:00.000Z' },
            { version: '0.2.0', created: '2026-04-01T11:00:00.000Z' },
          ],
        },
      });

      mockStorage.get.mockResolvedValue(Buffer.from(indexYaml));

      const repo: Repository = { id: 'r1', name: 'helm-repo' } as any;
      const result = await packageMethods.listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([
        expect.objectContaining({
          name: 'ravhub',
          latestVersion: '0.2.0',
        }),
      ]);
    });

    it('should aggregate charts from group members', async () => {
      const childIndexYaml = yaml.dump({
        entries: {
          ravhub: [{ version: '0.1.0', created: '2026-04-01T11:00:00.000Z' }],
        },
      });

      mockGetRepo.mockResolvedValue({
        id: 'child-1',
        name: 'helm-private',
        type: 'hosted',
        manager: 'helm',
      });

      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'helm/child-1/index.yaml') {
          return Buffer.from(childIndexYaml);
        }

        return null;
      });

      const repo: Repository = {
        id: 'group-1',
        name: 'helm-group',
        type: 'group',
        manager: 'helm',
        config: { members: ['child-1'] },
      } as any;

      const result = await packageMethods.listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([
        expect.objectContaining({
          name: 'ravhub',
          latestVersion: '0.1.0',
        }),
      ]);
    });

    it('should avoid infinite recursion when group members reference each other', async () => {
      mockGetRepo.mockImplementation(async (id: string) => {
        if (id === 'group-2') {
          return {
            id: 'group-2',
            name: 'helm-group-2',
            type: 'group',
            manager: 'helm',
            config: { members: ['group-1'] },
          } as Repository;
        }

        if (id === 'group-1') {
          return {
            id: 'group-1',
            name: 'helm-group-1',
            type: 'group',
            manager: 'helm',
            config: { members: ['group-2'] },
          } as Repository;
        }

        return null;
      });

      const repo: Repository = {
        id: 'group-1',
        name: 'helm-group-1',
        type: 'group',
        manager: 'helm',
        config: { members: ['group-2'] },
      } as any;

      const result = await packageMethods.listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([]);
    });
  });

  describe('getPackage', () => {
    it('should return chart artifacts with concrete versions instead of unknown', async () => {
      const indexYaml = yaml.dump({
        entries: {
          ravhub: [
            { version: '0.1.0', created: '2026-04-01T10:00:00.000Z' },
            { version: '0.2.0', created: '2026-04-01T11:00:00.000Z' },
          ],
        },
      });

      mockStorage.get.mockResolvedValue(Buffer.from(indexYaml));

      const repo: Repository = { id: 'r1', name: 'helm-repo' } as any;
      const result = await packageMethods.getPackage(repo, 'ravhub');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toEqual([
        expect.objectContaining({ version: '0.2.0' }),
        expect.objectContaining({ version: '0.1.0' }),
      ]);
    });

    it('should return package artifacts aggregated from group members', async () => {
      const childIndexYaml = yaml.dump({
        entries: {
          ravhub: [
            { version: '0.1.0', created: '2026-04-01T10:00:00.000Z' },
            { version: '0.2.0', created: '2026-04-01T11:00:00.000Z' },
          ],
        },
      });

      mockGetRepo.mockResolvedValue({
        id: 'child-1',
        name: 'helm-private',
        type: 'hosted',
        manager: 'helm',
      });

      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'helm/child-1/index.yaml') {
          return Buffer.from(childIndexYaml);
        }

        return null;
      });

      const repo: Repository = {
        id: 'group-1',
        name: 'helm-group',
        type: 'group',
        manager: 'helm',
        config: { members: ['child-1'] },
      } as any;

      const result = await packageMethods.getPackage(repo, 'ravhub');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toEqual([
        expect.objectContaining({ version: '0.2.0' }),
        expect.objectContaining({ version: '0.1.0' }),
      ]);
    });
  });

  describe('getInstallCommand', () => {
    it('should generate helm install commands', async () => {
      const repo: Repository = { name: 'helm-repo' } as any;
      const pkg = { name: 'my-chart', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands).toHaveLength(2);
      expect(commands[0].label).toBe('helm install');
      expect(commands[0].command).toContain('helm repo add helm-repo');
      expect(commands[0].command).toContain('helm repo update');
      expect(commands[0].command).toContain(
        'helm install my-chart helm-repo/my-chart --version 1.0.0',
      );
      expect(commands[1].label).toBe('helm dependency');
    });

    it('should encode repository URL in install commands', async () => {
      const repo: Repository = { name: 'helm repo#beta' } as any;
      const pkg = { name: 'my-chart', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands[0].command).toContain(
        'http://localhost:3000/repository/helm%20repo%23beta',
      );
      expect(commands[1].command).toContain(
        'repository: http://localhost:3000/repository/helm%20repo%23beta',
      );
    });

    it('should generate a safe helm alias for repository names with spaces', async () => {
      const repo: Repository = { name: 'helm repo#beta' } as any;
      const pkg = { name: 'my-chart', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands[0].command).toContain(
        'helm repo add helm-repo-beta http://localhost:3000/repository/helm%20repo%23beta',
      );
      expect(commands[0].command).toContain(
        'helm install my-chart helm-repo-beta/my-chart --version 1.0.0',
      );
    });

    it('should sanitize the suggested release name from the chart name', async () => {
      const repo: Repository = { name: 'helm repo#beta' } as any;
      const pkg = { name: 'RavHub Chart__Enterprise', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands[0].command).toContain(
        'helm install ravhub-chart-enterprise helm-repo-beta/RavHub Chart__Enterprise --version 1.0.0',
      );
    });

    it('should generate the exact guided command for ravhub public charts', async () => {
      const repo: Repository = { name: 'ravhub-charts' } as any;
      const pkg = { name: 'ravhub', version: '0.1.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands[0].command).toBe(`helm repo add ravhub-charts http://localhost:3000/repository/ravhub-charts
helm repo update
helm install ravhub ravhub-charts/ravhub --version 0.1.0`);
    });
  });
});
