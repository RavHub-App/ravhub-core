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

import { initStorage } from 'src/modules/plugins/impl/composer-plugin/storage/storage';

describe('Composer Plugin - Storage (Unit)', () => {
  let mockStorage: any;
  let mockGetRepo: any;
  let mockIndexArtifact: any;
  let context: any;
  let composerStorage: any;
  const repo = { id: 'r1', name: 'myrepo', type: 'hosted', config: {} } as any;

  beforeEach(() => {
    mockStorage = {
      save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'h1' }),
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
    };
    mockGetRepo = jest.fn();
    mockIndexArtifact = jest.fn();
    context = {
      storage: mockStorage,
      getRepo: mockGetRepo,
      indexArtifact: mockIndexArtifact,
    };
    const mod = initStorage(context);
    composerStorage = mod;
  });

  describe('upload', () => {
    it('should upload a package successfully', async () => {
      const pkg = {
        name: 'vendor/pkg',
        version: '1.0.0',
        content: Buffer.from('data'),
      };
      const res = await composerStorage.upload(repo, pkg);

      expect(res.ok).toBeTruthy();
      expect(mockStorage.save).toHaveBeenCalled();
      expect(res.id).toBe('vendor/pkg:1.0.0');
    });

    it('should respect re-deployment policy', async () => {
      const strictRepo = { ...repo, config: { allowRedeploy: false } };
      mockStorage.get.mockResolvedValue(Buffer.from('existing'));

      const pkg = { name: 'v/p', version: '1.0' };
      const res = await composerStorage.upload(strictRepo, pkg);

      expect(res.ok).toBeFalsy();
      expect(res.message).toContain('Redeployment');
    });

    it('should handle group upload with preferred writer', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: {
          members: ['m1'],
          writePolicy: 'preferred',
          preferredWriter: 'm1',
        },
      } as any;
      const memberRepo = { id: 'm1', type: 'hosted', config: {} } as any;
      mockGetRepo.mockResolvedValue(memberRepo);

      const pkg = { name: 'v/p', version: '1.0' };
      const res = await composerStorage.upload(groupRepo, pkg);

      expect(res.ok).toBeTruthy();
      expect(mockStorage.save).toHaveBeenCalled();
    });
  });

  describe('download', () => {
    it('should download a package', async () => {
      mockStorage.get.mockResolvedValue(Buffer.from('zipped-data'));
      const res = await composerStorage.download(repo, 'vendor/pkg', '1.0.0');

      expect(res.ok).toBeTruthy();
      expect(res.data).toBeDefined();
    });

    it('should return 404 if not found', async () => {
      mockStorage.get.mockResolvedValue(null);
      const res = await composerStorage.download(repo, 'vendor/pkg', '1.0.0');
      expect(res.ok).toBeFalsy();
    });
  });

  describe('handlePut', () => {
    it('should handle raw body put', async () => {
      const req = { body: Buffer.from('raw-data') };
      const res = await composerStorage.handlePut(repo, 'v/p/1.0.0.zip', req);

      expect(res.ok).toBeTruthy();
      expect(mockStorage.save).toHaveBeenCalled();
    });
  });

  describe('Group Write Policies', () => {
    it('should handle "first" policy', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1', 'm2'], writePolicy: 'first' },
      } as any;
      const m1 = { id: 'm1', type: 'hosted' } as any;
      const m2 = { id: 'm2', type: 'hosted' } as any;

      mockGetRepo.mockImplementation((id: string) => {
        if (id === 'm1') return Promise.resolve(m1);
        if (id === 'm2') return Promise.resolve(m2);
        return Promise.resolve(null);
      });

      // m1 fails, m2 succeeds
      mockStorage.save
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce({ size: 100 });

      const pkg = { name: 'v/p', version: '1.0' };
      const res = await composerStorage.upload(groupRepo, pkg);
      expect(res.ok).toBeTruthy();
    });

    it('should handle "mirror" policy', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1', 'm2'], writePolicy: 'mirror' },
      } as any;
      mockGetRepo.mockResolvedValue({ id: 'm', type: 'hosted' });

      const pkg = { name: 'v/p', version: '1.0' };
      await composerStorage.upload(groupRepo, pkg);
      // Should call save for each member (mocked both as 'm')
      expect(mockStorage.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('Hosted packages.json', () => {
    it('should generate packages.json for hosted repo', async () => {
      mockStorage.list.mockResolvedValue([
        'composer/r1/vendor/pkg/1.0.0.zip',
        'composer/r1/vendor/pkg/1.1.0.zip',
      ]);

      const res = await composerStorage.download(repo, 'packages.json');
      expect(res.ok).toBeTruthy();
      const data = JSON.parse(res.data);
      expect(data.packages['vendor/pkg']).toBeDefined();
      expect(data.packages['vendor/pkg']['1.0.0']).toBeDefined();
    });
  });
});
