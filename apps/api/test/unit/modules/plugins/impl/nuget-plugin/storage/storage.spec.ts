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

import { initStorage } from 'src/modules/plugins/impl/nuget-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/nuget-plugin/utils/key-utils';

jest.mock('src/modules/plugins/impl/nuget-plugin/utils/key-utils');

describe('NuGetPlugin Storage', () => {
  beforeEach(() => {
    (keyUtils.buildKey as jest.Mock).mockImplementation((...args) =>
      args.join('/'),
    );
    jest.clearAllMocks();
  });

  const createMockContext = () => ({
    storage: {
      save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
      get: jest.fn().mockResolvedValue(null),
      exists: jest.fn(),
      saveStream: jest.fn(),
      list: jest.fn().mockResolvedValue([]),
      delete: jest.fn(),
      getUrl: jest.fn(),
    },
    indexArtifact: jest.fn(),
    getRepo: jest.fn(),
  });

  const expectSuccess = (result: any) => {
    if (!result.ok) {
      console.error('Failure Message:', result.message);
    }
    expect(result.ok).toBe(true);
  };

  describe('upload', () => {
    it('should save and index artifact', async () => {
      const context = createMockContext();
      const methods = initStorage(context as any);
      const repo: any = {
        id: 'r1',
        name: 'nuget-repo',
        type: 'hosted',
        manager: 'nuget',
      };
      const pkg = {
        name: 'pkg',
        version: '1.0.0',
        content: Buffer.from('content'),
      };

      const result = await methods.upload(repo, pkg);
      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalled();
      expect(context.indexArtifact).toHaveBeenCalled();
    });

    it('should handle Group write policy "first"', async () => {
      const context = createMockContext();
      const r1: any = {
        id: 'r1',
        name: 'hosted1',
        type: 'hosted',
        manager: 'nuget',
      };
      const r2: any = {
        id: 'r2',
        name: 'hosted2',
        type: 'hosted',
        manager: 'nuget',
      };

      context.getRepo.mockImplementation(async (id) => {
        if (id === 'r1') return r1;
        if (id === 'r2') return r2;
        return null;
      });

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        name: 'g1',
        manager: 'nuget',
        config: { writePolicy: 'first', members: ['r1', 'r2'] },
      };

      const methods = initStorage(context as any);
      const pkg = {
        name: 'pkg',
        version: '1.0.0',
        content: Buffer.from('content'),
      };

      context.storage.save.mockImplementationOnce(() => {
        throw new Error('fail');
      });
      context.storage.save.mockResolvedValueOnce({ size: 100 });

      const result = await methods.upload(groupRepo, pkg);
      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalledTimes(2);
    });

    it('should handle Group write policy "preferred"', async () => {
      const context = createMockContext();
      const r1: any = {
        id: 'r1',
        name: 'hosted1',
        type: 'hosted',
        manager: 'nuget',
      };
      context.getRepo.mockResolvedValue(r1);

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        name: 'g1',
        manager: 'nuget',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'r1',
          members: ['r1'],
        },
      };

      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });

      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalled();
    });

    it('should handle Group write policy "mirror"', async () => {
      const context = createMockContext();
      const r1: any = {
        id: 'r1',
        name: 'h1',
        type: 'hosted',
        manager: 'nuget',
      };
      const r2: any = {
        id: 'r2',
        name: 'h2',
        type: 'hosted',
        manager: 'nuget',
      };
      context.getRepo.mockImplementation(async (id) => (id === 'r1' ? r1 : r2));

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        name: 'g1',
        manager: 'nuget',
        config: { writePolicy: 'mirror', members: ['r1', 'r2'] },
      };

      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });

      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalledTimes(2);
    });

    it('should handle Group write policy "mirror" failure', async () => {
      const context = createMockContext();
      const r1: any = {
        id: 'r1',
        name: 'h1',
        type: 'hosted',
        manager: 'nuget',
      };
      context.getRepo.mockResolvedValue(r1);

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'mirror', members: ['r1'] },
      };

      const methods = initStorage(context as any);
      context.storage.save.mockRejectedValue(new Error('fail'));

      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Mirror write failed');
    });

    it('should respect allowRedeploy policy', async () => {
      const context = createMockContext();
      const repo: any = {
        id: 'r1',
        type: 'hosted',
        config: { nuget: { allowRedeploy: false } },
      };
      context.storage.get.mockResolvedValue(Buffer.from('existing'));

      const methods = initStorage(context as any);
      const result = await methods.upload(repo, {
        name: 'pkg',
        version: '1.0.0',
      });

      expect(result.ok).toBe(false);
      expect(result.message).toContain('not allowed');
    });

    it('should handle buffer in upload payload', async () => {
      const context = createMockContext();
      const methods = initStorage(context as any);
      const repo: any = { id: 'r1', type: 'hosted' };

      const result = await methods.upload(repo, {
        name: 'pkg',
        version: '1.0.0',
        buffer: Buffer.from('buf'),
      });
      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('buf'),
      );
    });

    it('should handle missing preferred writer', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'preferred', members: ['r1'] },
      };
      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Preferred writer not configured');
    });

    it('should handle unavailable preferred writer', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'r1',
          members: ['r1'],
        },
      };
      context.getRepo.mockResolvedValue(null);
      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Preferred writer unavailable');
    });

    it('should handle mirror policy with no hosted members', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'mirror', members: ['p1'] },
      };
      context.getRepo.mockResolvedValue({ id: 'p1', type: 'proxy' });
      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('No hosted members');
    });

    it('should handle unknown write policy', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'invalid' },
      };
      const methods = initStorage(context as any);
      const result = await methods.upload(groupRepo, {
        name: 'pkg',
        version: '1.0.0',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Unknown write policy');
    });
  });

  describe('handlePut', () => {
    it('should save and index artifact on put', async () => {
      const context = createMockContext();
      const methods = initStorage(context as any);
      const repo: any = {
        id: 'r1',
        name: 'nuget-repo',
        type: 'hosted',
        manager: 'nuget',
      };
      const req = { body: Buffer.from('content') };

      const result = await methods.handlePut(
        repo,
        'pkg/1.0.0/pkg.1.0.0.nupkg',
        req,
      );
      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalled();
      expect(context.indexArtifact).toHaveBeenCalled();
    });

    it('should handle handlePut for Group', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        name: 'g1',
        manager: 'nuget',
        config: { writePolicy: 'first', members: ['r1'] },
      };
      const r1 = { id: 'r1', name: 'h1', type: 'hosted', manager: 'nuget' };
      context.getRepo.mockResolvedValue(r1);

      const methods = initStorage(context as any);
      const req = { body: Buffer.from('content') };
      const result = await methods.handlePut(
        groupRepo,
        'pkg/1.0.0/pkg.1.0.0.nupkg',
        req,
      );

      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalled();
    });

    it('should handle Group write policy "preferred" for handlePut', async () => {
      const context = createMockContext();
      const preferredRepo = {
        id: 'p1',
        name: 'pref',
        type: 'hosted',
        manager: 'nuget',
      };
      context.getRepo.mockResolvedValue(preferredRepo);

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'p1',
          members: ['p1'],
        },
      };
      const methods = initStorage(context as any);
      const result = await methods.handlePut(groupRepo, 'pkg/1.0.0/pkg.nupkg', {
        body: Buffer.from('data'),
      });
      expectSuccess(result);
    });

    it('should handle Group write policy "mirror" for handlePut', async () => {
      const context = createMockContext();
      const r1 = { id: 'r1', name: 'h1', type: 'hosted', manager: 'nuget' };
      context.getRepo.mockResolvedValue(r1);

      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'mirror', members: ['r1'] },
      };
      const methods = initStorage(context as any);
      const result = await methods.handlePut(groupRepo, 'pkg/1.0.0/pkg.nupkg', {
        body: Buffer.from('data'),
      });
      expectSuccess(result);
    });

    it('should reject handlePut if Group is read-only', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'none' },
      };
      const methods = initStorage(context as any);
      const result = await methods.handlePut(groupRepo, 'any', {});
      expect(result.ok).toBe(false);
      expect(result.message).toContain('read-only');
    });

    it('should handle streaming body in handlePut (via streamToBuffer)', async () => {
      const context = createMockContext();
      // Force streamToBuffer by removing saveStream
      (context.storage as any).saveStream = undefined;
      const methods = initStorage(context as any);
      const repo: any = { id: 'r1', type: 'hosted' };

      const mockStream: any = new (require('events').EventEmitter)();
      const promise = methods.handlePut(
        repo,
        'pkg/1.0.0/pkg.1.0.0.nupkg',
        mockStream,
      );

      mockStream.emit('data', Buffer.from('part1'));
      mockStream.emit('data', Buffer.from('part2'));
      mockStream.emit('end');

      const result = await promise;
      expectSuccess(result);
      expect(context.storage.save).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('part1part2'),
      );
    });

    it('should handle saveStream if available', async () => {
      const context = createMockContext();
      context.storage.saveStream.mockResolvedValue({ ok: true, size: 50 });
      const methods = initStorage(context as any);
      const repo: any = { id: 'r1', type: 'hosted' };
      const req = { body: null }; // Force stream path

      const result = await methods.handlePut(
        repo,
        'pkg/1.0.0/pkg.1.0.0.nupkg',
        req as any,
      );
      expectSuccess(result);
      expect(context.storage.saveStream).toHaveBeenCalled();
    });

    it('should handle indexing error gracefully', async () => {
      const context = createMockContext();
      context.indexArtifact.mockRejectedValue(new Error('index-fail'));
      const methods = initStorage(context as any);
      const repo: any = { id: 'r1', type: 'hosted' };

      const result = await methods.handlePut(repo, 'pkg/1.0.0/pkg.nupkg', {
        body: 'data',
      });
      expectSuccess(result); // Should still be success
    });

    it('should handle storage error in handlePut', async () => {
      const context = createMockContext();
      context.storage.save.mockRejectedValue(new Error('save-fail'));
      const methods = initStorage(context as any);
      const repo: any = { id: 'r1', type: 'hosted' };

      const result = await methods.handlePut(repo, 'pkg/1.0.0/pkg.nupkg', {
        body: 'data',
      });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('save-fail');
    });
  });

  describe('download', () => {
    it('should return V3 Service Index for hosted V3 repo', async () => {
      const context = createMockContext();
      const methods = initStorage(context as any);
      const repo: any = {
        id: 'r1',
        name: 'nuget-repo',
        type: 'hosted',
        manager: 'nuget',
        config: { nuget: { version: 'v3' } },
      };

      const result = await methods.download(repo, 'index.json');
      expectSuccess(result);
      expect(result.contentType).toBe('application/json');
      const body = JSON.parse(result.data?.toString() || '{}');
      expect(body.version).toBe('3.0.0');
    });

    it('should return V2 Service Document for hosted V2 repo', async () => {
      const context = createMockContext();
      const methods = initStorage(context as any);
      const repo: any = {
        id: 'r1',
        name: 'nuget-repo',
        type: 'hosted',
        manager: 'nuget',
        config: { nuget: { version: 'v2' } },
      };

      const result = await methods.download(repo, '');
      expectSuccess(result);
      expect(result.contentType).toBe('application/xml');
      expect(result.data?.toString()).toContain('<service');
    });

    it('should return V2 Atom Feed for list versions (Hosted)', async () => {
      const context = createMockContext();
      context.storage.list.mockResolvedValue([
        'nuget/r1/test-pkg/1.0.0',
        'nuget/r1/test-pkg/2.0.0',
      ]);
      const methods = initStorage(context as any);
      const repo: any = {
        id: 'r1',
        name: 'nuget-repo',
        type: 'hosted',
        manager: 'nuget',
        config: { nuget: { version: 'v2' } },
      };

      const result = await methods.download(
        repo,
        "FindPackagesById()?id='test-pkg'",
      );

      expectSuccess(result);
      expect(result.contentType).toBe('application/xml');
      const xml = result.data?.toString();
      expect(xml).toContain("Version='1.0.0'");
      expect(xml).toContain("Version='2.0.0'");
    });

    it('should rewrite URLs for V2 Proxy Repo', async () => {
      const context = createMockContext();
      const mockFetch = jest.fn();
      const repo: any = {
        id: 'p1',
        name: 'proxy',
        type: 'proxy',
        manager: 'nuget',
        config: {
          nuget: { version: 'v2' },
          proxyUrl: 'https://upstream.org/api/v2/',
        },
      };
      const methods = initStorage(context as any, mockFetch);

      mockFetch.mockResolvedValue({
        status: 200,
        body: Buffer.from(
          '<entry><content src="https://upstream.org/api/v2/package/pkg/1.0.0" /></entry>',
        ),
      });

      const result = await methods.download(
        repo,
        "FindPackagesById()?id='pkg'",
      );
      expectSuccess(result);
      const xml = result.data?.toString();
      expect(xml).toContain(
        'src="http://localhost:3000/repository/proxy/package/pkg/1.0.0"',
      );
    });

    it('should handle upstream V2 failure', async () => {
      const context = createMockContext();
      const mockFetch = jest.fn().mockResolvedValue({ status: 404 });
      const repo: any = {
        id: 'p1',
        type: 'proxy',
        config: { nuget: { version: 'v2' } },
      };
      const methods = initStorage(context as any, mockFetch);
      const result = await methods.download(
        repo,
        "FindPackagesById()?id='pkg'",
      );
      expect(result.ok).toBe(false);
    });

    it('should download binary .nupkg from Cache if available', async () => {
      const context = createMockContext();
      const mockFetch = jest.fn();
      const repo: any = {
        id: 'p1',
        name: 'proxy',
        type: 'proxy',
        manager: 'nuget',
      };

      context.storage.get.mockResolvedValue(Buffer.from('cached-content'));

      const methods = initStorage(context as any, mockFetch);
      const result = await methods.download(repo, 'pkg', '1.0.0');

      expectSuccess(result);
      expect(result.data).toEqual(Buffer.from('cached-content'));
    });

    it('should handle proxy member in group download', async () => {
      const context = createMockContext();
      const mockFetch = jest
        .fn()
        .mockResolvedValue({ status: 200, body: Buffer.from('proxy-content') });
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        manager: 'nuget',
        config: { members: ['p1'] },
      };
      const p1 = { id: 'p1', name: 'proxy1', type: 'proxy', manager: 'nuget' };
      context.getRepo.mockResolvedValue(p1);

      const methods = initStorage(context as any, mockFetch);
      const result = await methods.download(groupRepo, 'pkg', '1.0.0');

      expectSuccess(result);
      expect(result.data).toEqual(Buffer.from('proxy-content'));
    });

    it('should parse version from name in download if missing', async () => {
      const context = createMockContext();
      const repo: any = { id: 'r1', type: 'hosted' };
      context.storage.get.mockResolvedValue(Buffer.from('content'));

      const methods = initStorage(context as any);
      const result = await methods.download(repo, 'pkg/1.0.0');

      expectSuccess(result);
    });

    it('should return error if not found in group', async () => {
      const context = createMockContext();
      const groupRepo: any = {
        id: 'g1',
        type: 'group',
        manager: 'nuget',
        config: { members: ['r1'] },
      };
      context.getRepo.mockResolvedValue({ id: 'r1', type: 'hosted' });
      context.storage.get.mockResolvedValue(null);

      const methods = initStorage(context as any);
      const result = await methods.download(groupRepo, 'pkg', '1.0.0');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Not found in group');
    });
  });
});
