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

import { ProxyCacheService } from 'src/modules/plugins/proxy-cache.service';
import { RedisService } from 'src/modules/redis/redis.service';
import { StorageService } from 'src/modules/storage/storage.service';
import AppDataSource from 'src/data-source';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
  },
}));

jest.mock('src/storage/key-utils', () => ({
  buildKey: jest.fn((manager, repo, path) => `${manager}/${repo}/${path}`),
}));

describe('ProxyCacheService (Unit)', () => {
  let service: ProxyCacheService;
  let redisService: jest.Mocked<RedisService>;
  let storageService: jest.Mocked<StorageService>;
  let mockRepoRepo: any;

  beforeEach(() => {
    redisService = {
      isEnabled: jest.fn().mockReturnValue(false),
      getClient: jest.fn(),
    } as any;

    storageService = {
      list: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      getMetadata: jest.fn().mockResolvedValue({ mtime: new Date() }),
    } as any;

    mockRepoRepo = {
      findOne: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepoRepo);

    service = new ProxyCacheService(redisService, storageService);
  });

  describe('clearProxyCache', () => {
    it('should clear cache entries for repository (in-memory)', async () => {
      const cache = service.getCache();
      cache.set('repo1:key1', { ts: Date.now(), payload: 'data1' });
      cache.set('repo1:key2', { ts: Date.now(), payload: 'data2' });
      cache.set('repo2:key1', { ts: Date.now(), payload: 'data3' });

      const cleared = await service.clearProxyCache('repo1');

      expect(cleared).toBe(2);
      expect(cache.has('repo1:key1')).toBe(false);
      expect(cache.has('repo1:key2')).toBe(false);
      expect(cache.has('repo2:key1')).toBe(true);
    });

    it('should clear cache entries for repository (Redis)', async () => {
      const mockClient = {
        scan: jest
          .fn()
          .mockResolvedValueOnce([
            '5',
            ['ravhub:proxy:cache:repo1:key1', 'ravhub:proxy:cache:repo1:key2'],
          ])
          .mockResolvedValueOnce(['0', []]),
        del: jest.fn().mockResolvedValue(2),
      };

      redisService.isEnabled.mockReturnValue(true);
      redisService.getClient.mockReturnValue(mockClient as any);

      const cleared = await service.clearProxyCache('repo1');

      expect(cleared).toBe(2);
      expect(mockClient.del).toHaveBeenCalledWith(
        'ravhub:proxy:cache:repo1:key1',
        'ravhub:proxy:cache:repo1:key2',
      );
    });
  });

  describe('clearAllProxyCache', () => {
    it('should clear all cache entries (in-memory)', async () => {
      const cache = service.getCache();
      cache.set('repo1:key1', { ts: Date.now(), payload: 'data1' });
      cache.set('repo2:key2', { ts: Date.now(), payload: 'data2' });

      const cleared = await service.clearAllProxyCache();

      expect(cleared).toBe(2);
      expect(cache.size).toBe(0);
    });

    it('should clear all cache entries (Redis)', async () => {
      const mockClient = {
        scan: jest
          .fn()
          .mockResolvedValueOnce(['5', ['key1', 'key2']])
          .mockResolvedValueOnce(['0', ['key3']]),
        del: jest.fn().mockResolvedValue(3),
      };

      redisService.isEnabled.mockReturnValue(true);
      redisService.getClient.mockReturnValue(mockClient as any);

      const cleared = await service.clearAllProxyCache();

      expect(cleared).toBe(3);
      expect(mockClient.del).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCacheStats', () => {
    it('should return cache stats (in-memory)', async () => {
      const cache = service.getCache();
      cache.set('repo1:key1', { ts: Date.now(), payload: 'data1' });
      cache.set('repo1:key2', { ts: Date.now(), payload: 'data2' });
      cache.set('repo2:key1', { ts: Date.now(), payload: 'data3' });

      const stats = await service.getCacheStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.byRepository['repo1']).toBe(2);
      expect(stats.byRepository['repo2']).toBe(1);
    });

    it('should return cache stats (Redis)', async () => {
      const mockClient = {
        scan: jest
          .fn()
          .mockResolvedValueOnce([
            '5',
            ['ravhub:proxy:cache:repo1:url1', 'ravhub:proxy:cache:repo1:url2'],
          ])
          .mockResolvedValueOnce(['0', ['ravhub:proxy:cache:repo2:url1']]),
      };

      redisService.isEnabled.mockReturnValue(true);
      redisService.getClient.mockReturnValue(mockClient as any);

      const stats = await service.getCacheStats();

      expect(stats.totalEntries).toBe(3);
      expect(stats.byRepository['repo1']).toBe(2);
      expect(stats.byRepository['repo2']).toBe(1);
    });
  });

  describe('getCache', () => {
    it('should return the internal cache map', () => {
      const cache = service.getCache();
      expect(cache).toBeInstanceOf(Map);
    });
  });

  describe('cleanupProxyCache', () => {
    it('should cleanup old files for proxy repository', async () => {
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        type: 'proxy',
        manager: 'npm',
        config: { cacheEnabled: true, cacheMaxAgeDays: 1 },
      };
      mockRepoRepo.findOne.mockResolvedValue(repo);

      // Old file
      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
      storageService.list.mockResolvedValue([
        'npm/test-repo/old-pkg.tgz',
        'npm/test-repo/new-pkg.tgz',
      ]);
      storageService.getMetadata.mockImplementation(async (path) => {
        if (path.includes('old')) return { mtime: oldDate, size: 100 };
        return { mtime: new Date(), size: 100 }; // now
      });

      const deleted = await service.cleanupProxyCache('repo1');

      expect(deleted).toBe(1);
      expect(storageService.delete).toHaveBeenCalledWith(
        'npm/test-repo/old-pkg.tgz',
      );
      expect(storageService.delete).not.toHaveBeenCalledWith(
        'npm/test-repo/new-pkg.tgz',
      );
    });

    it('should handle docker cleanup specific logic', async () => {
      const repo = {
        id: 'repo1',
        name: 'docker-repo',
        type: 'proxy',
        manager: 'docker',
        config: { cacheEnabled: true, cacheMaxAgeDays: 1 },
      };
      mockRepoRepo.findOne.mockResolvedValue(repo);

      const oldDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      storageService.list.mockResolvedValue([
        'docker/repo1/manifests/tags.json', // should be checked
        'docker/repo1/blobs/sha256/123', // skipped by logic
        'docker/repo1/proxy/temp', // should be checked
      ]);

      storageService.getMetadata.mockResolvedValue({
        mtime: oldDate,
        size: 100,
      });

      const deleted = await service.cleanupProxyCache('repo1');

      expect(deleted).toBe(2);
    });

    it('should return 0 if repo not found or not proxy', async () => {
      mockRepoRepo.findOne.mockResolvedValue(null);
      const res = await service.cleanupProxyCache('r1');
      expect(res).toBe(0);

      mockRepoRepo.findOne.mockResolvedValue({ type: 'hosted' });
      const res2 = await service.cleanupProxyCache('r1');
      expect(res2).toBe(0);
    });
  });
});
