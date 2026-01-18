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

describe('Composer Plugin - Packages List (Unit)', () => {
  let mockStorage: any;
  let listVersions: any;
  let getInstallCommand: any;
  const repo = { id: 'r1', name: 'mycomp' } as any;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
    };
    const context: any = { storage: mockStorage };
    const mod = initPackages(context);
    listVersions = mod.listVersions;
    getInstallCommand = mod.getInstallCommand;
  });

  describe('listVersions', () => {
    it('should list versions from storage', async () => {
      // Structure: composer/r1/vendor/package1/1.0.0
      // versionIndex = 2 + 2 = 4
      // key parts: ["composer", "r1", "vendor", "package1", "1.0.0"]
      // parts[4] = "1.0.0"
      mockStorage.list.mockImplementation((prefix: string) => {
        if (prefix.includes('vendor/package1') && !prefix.includes('proxy')) {
          return Promise.resolve([
            'composer/r1/vendor/package1/1.0.0',
            'composer/r1/vendor/package1/1.1.0',
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await listVersions(repo, 'vendor/package1');
      expect(res.ok).toBeTruthy();
      expect(res.versions).toContain('1.0.0');
      expect(res.versions).toContain('1.1.0');
    });

    it('should handle proxy keys', async () => {
      // Structure: composer/r1/proxy/vendor/package1/1.0.0-proxy
      // versionIndex + 1 = 4 + 1 = 5
      // key parts: ["composer", "r1", "proxy", "vendor", "package1", "1.0.0-proxy"]
      // parts[5] = "1.0.0-proxy"
      mockStorage.list.mockImplementation((prefix: string) => {
        if (prefix.includes('proxy')) {
          return Promise.resolve([
            'composer/r1/proxy/vendor/package1/1.0.0-proxy',
          ]);
        }
        return Promise.resolve([]);
      });

      const res = await listVersions(repo, 'vendor/package1');
      expect(res.versions).toContain('1.0.0-proxy');
    });
  });

  describe('getInstallCommand', () => {
    it('should return commands', async () => {
      const pkg = { name: 'v/p', version: '1.0' };
      const res = await getInstallCommand(repo, pkg);
      expect(res).toHaveLength(3);
      expect(res[0].command).toContain('composer require v/p:1.0');
    });
  });
});
