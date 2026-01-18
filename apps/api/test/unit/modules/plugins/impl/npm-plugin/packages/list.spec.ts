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

import { initPackages } from 'src/modules/plugins/impl/npm-plugin/packages/list';
import { Repository } from 'src/modules/plugins/impl/npm-plugin/utils/types';

jest.mock('src/modules/plugins/impl/npm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('NpmPlugin Packages', () => {
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
    it('should list versions from package.json', async () => {
      const packageJson = JSON.stringify({
        versions: { '1.0.0': {}, '2.0.0': {} },
      });
      mockStorage.get.mockResolvedValue(Buffer.from(packageJson));

      const repo: Repository = { id: 'r1', name: 'npm-repo' } as any;
      const result = await packageMethods.listVersions(repo, 'test-package');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('2.0.0');
    });

    it('should return empty array when no versions found', async () => {
      mockStorage.get.mockResolvedValue(null);

      const repo: Repository = { id: 'r1', name: 'npm-repo' } as any;
      const result = await packageMethods.listVersions(repo, 'test-package');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual([]);
    });
  });

  describe('getInstallCommand', () => {
    it('should generate install commands', async () => {
      const repo: Repository = { name: 'npm-repo' } as any;
      const pkg = { name: 'test-package', version: '1.0.0' };

      const commands = await packageMethods.getInstallCommand(repo, pkg);

      expect(commands).toHaveLength(4);
      expect(commands[0].label).toBe('npm');
      expect(commands[0].command).toContain('npm install test-package@1.0.0');
      expect(commands[1].label).toBe('yarn');
      expect(commands[2].label).toBe('pnpm');
      expect(commands[3].label).toBe('.npmrc');
    });
  });
});
