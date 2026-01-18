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

import { initPackages } from 'src/modules/plugins/impl/composer-plugin/packages/list';
import { PluginContext } from 'src/modules/plugins/impl/composer-plugin/utils/types';

jest.mock('src/modules/plugins/impl/composer-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('ComposerPlugin Packages List', () => {
  let mockContext: PluginContext;
  let mockStorage: any;
  let packages: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
    };
    mockContext = {
      storage: mockStorage,
      repo: {} as any,
    } as any;

    packages = initPackages(mockContext);
    jest.clearAllMocks();
  });

  describe('listVersions', () => {
    it('should list versions from storage', async () => {
      const repo = { id: 'repo1', name: 'my-repo' };
      // Simulate keys: composer/repo1/vendor/pkg/1.0.0
      // name = vendor/pkg
      // nameParts = [vendor, pkg] (len=2)
      // versionIndex = 2 + 2 = 4?
      // "composer/repo1/vendor/pkg/v1/meta"
      // Split: 0:composer, 1:repo1, 2:vendor, 3:pkg, 4:v1, 5:meta
      // Logic: parts[4] is version?

      mockStorage.list.mockImplementation((prefix: string) => {
        if (prefix.includes('repo1/vendor/pkg')) {
          return Promise.resolve([
            'composer/repo1/vendor/pkg/1.0.0',
            'composer/repo1/vendor/pkg/1.0.1/something',
          ]);
        }
        return Promise.resolve([]);
      });

      const result = await packages.listVersions(repo as any, 'vendor/pkg');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('1.0.1');
    });

    it('should list proxy versions', async () => {
      const repo = { id: 'repo1', name: 'my-repo' };
      // Proxy keys: composer/repo1/proxy/vendor/pkg/2.0.0
      // versionIndex + 1 = 5?
      // "composer/repo1/proxy/vendor/pkg/2.0.0"
      // 0:composer, 1:repo1, 2:proxy, 3:vendor, 4:pkg, 5:2.0.0

      mockStorage.list.mockImplementation((prefix: string) => {
        if (prefix.includes('proxy')) {
          return Promise.resolve(['composer/repo1/proxy/vendor/pkg/2.0.0']);
        }
        return Promise.resolve([]);
      });

      const result = await packages.listVersions(repo as any, 'vendor/pkg');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('2.0.0');
    });

    it('should handle storage errors gracefully', async () => {
      mockStorage.list.mockRejectedValue(new Error('Storage failure'));
      const repo = { id: 'repo1', name: 'my-repo' };

      const result = await packages.listVersions(repo as any, 'vendor/pkg');

      // Should return empty list if all fail
      expect(result.ok).toBe(true);
      expect(result.versions).toEqual([]);
    });
  });

  describe('getInstallCommand', () => {
    it('should generate composer install commands', async () => {
      const repo = { id: 'r1', name: 'my-repo' };
      const pkg = { name: 'vendor/package', version: '1.2.3' };

      process.env.API_HOST = 'test.com';

      const commands = await packages.getInstallCommand(repo as any, pkg);

      expect(commands).toHaveLength(3);
      expect(commands[0].label).toBe('composer cli');
      expect(commands[0].command).toContain(
        'composer config repositories.my-repo',
      );
      expect(commands[0].command).toContain(
        'composer require vendor/package:1.2.3',
      );
    });
  });
});
