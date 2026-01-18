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

import { initPackages } from 'src/modules/plugins/impl/helm-plugin/packages/list';
import { Repository } from 'src/plugins-core/plugin.interface';
import * as yaml from 'js-yaml';

jest.mock('src/modules/plugins/impl/helm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('HelmPlugin Packages', () => {
  let mockStorage: any;
  let packageMethods: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
    };
    packageMethods = initPackages({ storage: mockStorage } as any);
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
  });

  describe('getInstallCommand', () => {
    it('should generate helm install commands', async () => {
      const repo: Repository = { name: 'helm-repo' } as any;
      const pkg = { name: 'my-chart', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands).toHaveLength(2);
      expect(commands[0].label).toBe('helm install');
      expect(commands[0].command).toContain('helm repo add helm-repo');
      expect(commands[1].label).toBe('helm dependency');
    });
  });
});
