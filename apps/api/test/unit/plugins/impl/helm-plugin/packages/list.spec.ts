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
import * as yaml from 'js-yaml';

describe('Helm Plugin - Packages List (Unit)', () => {
  let mockStorage: any;
  let listVersions: any;
  let getInstallCommand: any;
  const repo = { id: 'r1', name: 'myhelm', type: 'hosted' } as any;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
    };
    const context: any = { storage: mockStorage };
    const mod = initPackages(context);
    listVersions = mod.listVersions;
    getInstallCommand = mod.getInstallCommand;
  });

  describe('listVersions', () => {
    it('should return versions from index.yaml', async () => {
      const indexObj = {
        entries: {
          mychart: [{ version: '1.0.0' }, { version: '1.1.0' }],
        },
      };
      mockStorage.get.mockResolvedValue(Buffer.from(yaml.dump(indexObj)));

      const res = await listVersions(repo, 'mychart');

      expect(res.ok).toBeTruthy();
      expect(res.versions).toContain('1.0.0');
      expect(res.versions).toContain('1.1.0');
    });

    it('should handle missing index.yaml', async () => {
      mockStorage.get.mockResolvedValue(null);
      const res = await listVersions(repo, 'mychart');
      expect(res.ok).toBeTruthy();
      expect(res.versions).toHaveLength(0);
    });
  });

  describe('getInstallCommand', () => {
    it('should return correct helm commands', async () => {
      const pkg = { name: 'mychart', version: '1.0.0' };
      const res = await getInstallCommand(repo, pkg);

      expect(res).toHaveLength(2);
      expect(res[0].command).toContain('helm repo add myhelm');
      expect(res[0].command).toContain('1.0.0');
    });
  });
});
