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

describe('Docker Plugin - Packages List (Unit)', () => {
  let mockStorage: any;
  let mockGetRepo: any;
  const repo = { id: 'r1', name: 'my-docker', type: 'hosted' } as any;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn().mockResolvedValue(null),
    };
    mockGetRepo = jest.fn();
    initPackages({ storage: mockStorage, getRepo: mockGetRepo });
  });

  describe('listPackages', () => {
    it('should list packages from storage keys', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/my-image/manifests/latest',
        'docker/r1/my-image/manifests/v1',
        'docker/r1/other/manifests/v2',
        'docker/r1/other/blobs/abc',
      ]);

      const res = await listPackages(repo);
      expect(res.ok).toBeTruthy();
      expect(res.packages!).toHaveLength(2);
      expect(res.packages!.find((p) => p.name === 'my-image')).toBeDefined();
    });

    it('should aggregate packages for group repo', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1'] },
      } as any;
      const member = { id: 'm1', name: 'm1', type: 'hosted' } as any;

      mockGetRepo.mockResolvedValue(member);
      mockStorage.list.mockResolvedValue(['docker/m1/img1/manifests/v1']);

      const res = await listPackages(groupRepo);
      expect(res.ok).toBeTruthy();
      expect(res.packages!).toHaveLength(1);
      expect(res.packages![0].name).toBe('img1');
    });

    it('should aggregate packages for group repo and deduplicate by name', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1', 'm2'] },
      } as any;

      const m1 = { id: 'm1', name: 'm1', type: 'hosted' } as any;
      const m2 = { id: 'm2', name: 'm2', type: 'hosted' } as any;

      mockGetRepo.mockImplementation((id: string) => {
        if (id === 'm1') return Promise.resolve(m1);
        if (id === 'm2') return Promise.resolve(m2);
        return Promise.resolve(null);
      });

      mockStorage.list.mockImplementation((prefix: string) => {
        if (prefix === 'docker/m1/')
          return Promise.resolve(['docker/m1/img1/manifests/v1']);
        if (prefix === 'docker/m2/')
          return Promise.resolve([
            'docker/m2/img1/manifests/v2',
            'docker/m2/img2/manifests/latest',
          ]);
        return Promise.resolve([]);
      });

      const res = await listPackages(groupRepo);
      expect(res.ok).toBeTruthy();
      expect(res.packages!).toHaveLength(2);

      expect(res.packages!.find((p) => p.name === 'img1')).toBeDefined();
      expect(res.packages!.find((p) => p.name === 'img2')).toBeDefined();
    });
  });

  describe('getPackage', () => {
    it('should return artifacts (tags) for an image', async () => {
      const manifest = JSON.stringify({
        layers: [{ size: 100 }, { size: 200 }],
        config: { size: 50 },
      });
      mockStorage.list.mockResolvedValue(['docker/r1/my-image/manifests/v1']);
      mockStorage.get.mockResolvedValue(Buffer.from(manifest));

      const res = await getPackage(repo, 'my-image');
      expect(res.ok).toBeTruthy();
      expect(res.artifacts!).toHaveLength(1);
      expect(res.artifacts![0].version).toBe('v1');
      expect(res.artifacts![0].size).toBe(350);
    });
  });

  describe('getPackage (Group)', () => {
    it('should aggregate tags from members in a group', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1'] },
        accessUrl: 'http://my-registry',
      } as any;
      const member = { id: 'm1', name: 'm1', type: 'hosted' } as any;
      mockGetRepo.mockResolvedValue(member);

      mockStorage.list.mockResolvedValue(['docker/m1/my-image/manifests/v1']);
      mockStorage.get.mockResolvedValue(Buffer.from('{}'));

      const res = await getPackage(groupRepo, 'my-image');
      expect(res.ok).toBeTruthy();
      expect(res.artifacts!).toHaveLength(1);
      expect(res.artifacts![0].installCommand).toContain(
        'my-registry/my-image:v1',
      );
    });
  });

  describe('listVersions', () => {
    it('should list tags', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/img/manifests/v1',
        'docker/r1/img/manifests/v2',
      ]);
      const res = await listVersions(repo, 'img');
      expect(res.ok).toBeTruthy();
      expect(res.versions!).toContain('v1');
      expect(res.versions!).toContain('v2');
    });
  });

  describe('getInstallCommand', () => {
    it('should return docker pull command', async () => {
      const pkg = { name: 'myimg', version: 'v1' };
      const res = await getInstallCommand(repo, pkg);
      expect(res[0].command).toContain('docker pull');
      expect(res[0].command).toContain('myimg:v1');
    });
  });
});
