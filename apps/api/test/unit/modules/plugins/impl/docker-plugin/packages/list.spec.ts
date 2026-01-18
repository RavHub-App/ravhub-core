/*
 * Copyright (C) 2026 RavHub Team
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

import {
  initPackages,
  listPackages,
  getPackage,
  listVersions,
  getInstallCommand,
} from 'src/modules/plugins/impl/docker-plugin/packages/list';
import { Repository } from 'src/modules/plugins/impl/docker-plugin/utils/types';

jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('DockerPlugin Packages', () => {
  let mockStorage: any;
  let mockGetRepo: jest.Mock;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
    };
    mockGetRepo = jest.fn();

    initPackages({ storage: mockStorage, getRepo: mockGetRepo });
    jest.clearAllMocks();
  });

  describe('listPackages', () => {
    const repo: Repository = {
      id: 'r1',
      name: 'docker-repo',
      type: 'hosted',
    } as any;

    it('should list packages from hosted repo', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
        'docker/r1/redis/manifests/alpine',
      ]);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(2);
      expect(result.packages?.map((p) => p.name)).toContain('nginx');
      expect(result.packages?.map((p) => p.name)).toContain('redis');
    });

    it('should filter out digest-based keys', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/sha256:abc123',
      ]);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(1);
      expect(result.packages?.[0].latestVersion).toBe('latest');
    });

    it('should handle group repo', async () => {
      const groupRepo: Repository = {
        type: 'group',
        config: { members: ['host1', 'host2'] },
      } as any;

      const hostedRepo: Repository = { id: 'host1', type: 'hosted' } as any;
      mockGetRepo.mockResolvedValue(hostedRepo);
      mockStorage.list.mockResolvedValue([
        'docker/host1/nginx/manifests/latest',
      ]);

      const result = await listPackages(groupRepo);

      expect(result.ok).toBe(true);
      expect(mockGetRepo).toHaveBeenCalled();
    });

    it('should return empty array for group with no members', async () => {
      const groupRepo: Repository = {
        type: 'group',
        config: { members: [] },
      } as any;

      const result = await listPackages(groupRepo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([]);
    });
  });

  describe('getPackage', () => {
    const repo: Repository = {
      id: 'r1',
      accessUrl: 'http://localhost:5000',
    } as any;

    it('should get package with all tags', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
      ]);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            layers: [{ size: 1000 }, { size: 2000 }],
            config: { size: 500 },
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts?.[0].installCommand).toContain('docker pull');
    });

    it('should calculate size from manifest', async () => {
      mockStorage.list.mockResolvedValue(['docker/r1/nginx/manifests/latest']);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            layers: [{ size: 1000 }, { size: 2000 }],
            config: { size: 500 },
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.artifacts?.[0].size).toBe(3500);
    });

    it('should handle manifest list', async () => {
      mockStorage.list.mockResolvedValue(['docker/r1/nginx/manifests/latest']);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            manifests: [{ size: 5000 }, { size: 3000 }],
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.artifacts?.[0].size).toBe(8000);
    });
  });

  describe('listVersions', () => {
    const repo: Repository = { id: 'r1', name: 'docker-repo' } as any;

    it('should list versions for an image', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
        'docker/r1/nginx/manifests/1.1.0',
      ]);

      const result = await listVersions(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('latest');
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('1.1.0');
    });

    it('should filter out digest tags', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/sha256:abc123',
      ]);

      const result = await listVersions(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['latest']);
    });
  });

  describe('getInstallCommand', () => {
    const repo: Repository = { accessUrl: 'http://localhost:5000' } as any;

    it('should generate install commands', async () => {
      const pkg = { name: 'nginx', version: 'latest' };
      const commands = await getInstallCommand(repo, pkg);

      expect(commands).toHaveLength(3);
      expect(commands[0].label).toBe('docker pull');
      expect(commands[0].command).toContain(
        'docker pull localhost:5000/nginx:latest',
      );
      expect(commands[1].label).toBe('skopeo copy');
      expect(commands[2].label).toBe('Kubernetes (deployment)');
    });

    it('should strip protocol from accessUrl', async () => {
      const repoWithHttps: Repository = {
        accessUrl: 'https://registry.example.com',
      } as any;
      const pkg = { name: 'myimage', version: '1.0.0' };

      const commands = await getInstallCommand(repoWithHttps, pkg);

      expect(commands[0].command).toContain(
        'registry.example.com/myimage:1.0.0',
      );
      expect(commands[0].command).not.toContain('https://');
    });
  });
});
