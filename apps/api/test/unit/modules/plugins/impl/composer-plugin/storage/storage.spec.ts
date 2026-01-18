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
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/composer-plugin/utils/types';

jest.mock('src/modules/plugins/impl/composer-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  default: jest.fn(),
}));

describe('ComposerPlugin Storage', () => {
  let mockContext: PluginContext;
  let mockStorage: any;
  let storageMethods: ReturnType<typeof initStorage>;
  let mockProxyHelper: jest.Mock;

  beforeEach(() => {
    mockStorage = {
      save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc123' }),
      saveStream: jest
        .fn()
        .mockResolvedValue({ size: 100, contentHash: 'abc123' }),
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
    };
    mockContext = {
      storage: mockStorage,
      getRepo: jest.fn(),
      indexArtifact: jest.fn(),
    } as any;

    mockProxyHelper = require('src/plugins-core/proxy-helper')
      .default as jest.Mock;

    storageMethods = initStorage(mockContext);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    const repo: Repository = { id: 'r1', type: 'hosted', config: {} } as any;

    it('should upload package successfully', async () => {
      const pkg = {
        name: 'vendor/package',
        version: '1.0.0',
        content: Buffer.from('data'),
      };
      const result = await storageMethods.upload(repo, pkg);

      expect(result.ok).toBe(true);
      expect(result.id).toBe('vendor/package:1.0.0');
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should reject redeploy when not allowed', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      mockStorage.get.mockResolvedValueOnce(Buffer.from('existing'));

      const pkg = { name: 'vendor/package', version: '1.0.0' };
      const result = await storageMethods.upload(repoNoRedeploy as any, pkg);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('not allowed');
    });

    it('should handle base64 encoded content', async () => {
      const pkg = {
        name: 'vendor/package',
        version: '1.0.0',
        content: Buffer.from('data').toString('base64'),
        encoding: 'base64',
      };

      const result = await storageMethods.upload(repo, pkg);
      expect(result.ok).toBe(true);
    });

    it('should handle group repo with preferred writer', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'host1',
          members: ['host1'],
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted', config: {} };
      (mockContext.getRepo as jest.Mock).mockResolvedValue(hostedRepo);

      const pkg = { name: 'vendor/pkg', version: '1.0.0' };
      const result = await storageMethods.upload(groupRepo as any, pkg);

      expect(mockContext.getRepo).toHaveBeenCalledWith('host1');
      expect(result.ok).toBe(true);
    });

    it('should handle group repo with first policy', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'first',
          members: ['host1', 'host2'],
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted', config: {} };
      (mockContext.getRepo as jest.Mock).mockResolvedValue(hostedRepo);

      const pkg = { name: 'vendor/pkg', version: '1.0.0' };
      const result = await storageMethods.upload(groupRepo as any, pkg);

      expect(result.ok).toBe(true);
    });

    it('should handle group repo with mirror policy', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'mirror',
          members: ['host1', 'host2'],
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted', config: {} };
      (mockContext.getRepo as jest.Mock).mockResolvedValue(hostedRepo);

      const pkg = { name: 'vendor/pkg', version: '1.0.0' };
      const result = await storageMethods.upload(groupRepo as any, pkg);

      expect(result.ok).toBe(true);
    });

    it('should reject group with none write policy', async () => {
      const groupRepo = {
        type: 'group',
        config: { writePolicy: 'none' },
      };

      const result = await storageMethods.upload(groupRepo as any, {});
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Group is read-only');
    });
  });

  describe('handlePut', () => {
    const repo: Repository = {
      id: 'r1',
      type: 'hosted',
      name: 'my-repo',
      config: {},
    } as any;

    it('should handle streaming upload for .zip file', async () => {
      // Test with body present (simpler path)
      const req = {
        body: Buffer.from('zip content'),
      };

      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        req as any,
      );

      expect(result.ok).toBe(true);
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should handle Buffer body', async () => {
      const req = { body: Buffer.from('data') };
      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        req,
      );

      expect(result.ok).toBe(true);
    });

    it('should handle JSON body', async () => {
      const req = { body: { name: 'vendor/pkg', version: '1.0.0' } };
      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        req,
      );

      expect(result.ok).toBe(true);
    });

    it('should parse package info from path', async () => {
      const req = { body: Buffer.from('data') };
      const result = await storageMethods.handlePut(
        repo,
        'vendor/package/2.0.0.zip',
        req,
      );

      expect(result.ok).toBe(true);
      expect(result.metadata.name).toBe('vendor/package');
      expect(result.metadata.version).toBe('2.0.0');
    });

    it('should use saveStream when available and no body', async () => {
      const chunks = [Buffer.from('a'), Buffer.from('b')];
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk;
        }
      };

      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        mockReq as any,
      );

      expect(result.ok).toBe(true);
      expect(mockStorage.saveStream).toHaveBeenCalled();
    });

    it('should handle saveStream indexing failure gracefully', async () => {
      (mockContext.indexArtifact as jest.Mock).mockRejectedValue(new Error('index fail'));
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('data');
        }
      };

      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        mockReq as any,
      );

      expect(result.ok).toBe(true);
    });

    it('should handle stream body when saveStream not available', async () => {
      mockStorage.saveStream = undefined;
      const chunks = [Buffer.from('a'), Buffer.from('b')];
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk;
        }
      };

      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        mockReq as any,
      );

      expect(result.ok).toBe(true);
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should handle saveStream errors', async () => {
      mockStorage.saveStream.mockRejectedValue(new Error('stream error'));
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          yield Buffer.from('data');
        }
      };

      const result = await storageMethods.handlePut(
        repo,
        'vendor/pkg/1.0.0.zip',
        mockReq as any,
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain('stream error');
    });
  });

  describe('proxyDownload', () => {
    const repo: Repository = {
      id: 'r1',
      type: 'proxy',
      config: { cacheEnabled: true, cacheMaxAgeDays: 7 },
    } as any;

    it('should return cached version if available', async () => {
      const cachedData = Buffer.from('cached zip');
      mockStorage.get.mockResolvedValue(cachedData);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        headers: { 'content-length': String(cachedData.length) },
      });

      const result = await storageMethods.proxyDownload(
        repo,
        'https://packagist.org/p2/vendor/pkg.json',
        'vendor/pkg',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(cachedData);
      expect(result.skipCache).toBe(true);
    });

    it('should download from upstream on cache miss', async () => {
      mockStorage.get.mockResolvedValue(null);
      const upstreamData = Buffer.from('upstream zip');
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: upstreamData,
      });

      const result = await storageMethods.proxyDownload(
        repo,
        'https://packagist.org/p2/vendor/pkg.json',
        'vendor/pkg',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
      expect(mockStorage.save).toHaveBeenCalled();
      expect(mockContext.indexArtifact).toHaveBeenCalled();
    });

    it('should redownload if size mismatch', async () => {
      const cachedData = Buffer.from('old');
      mockStorage.get.mockResolvedValue(cachedData);
      mockProxyHelper
        .mockResolvedValueOnce({
          ok: true,
          headers: { 'content-length': '999' }, // Different size
        })
        .mockResolvedValueOnce({
          ok: true,
          body: Buffer.from('new data'),
        });

      const result = await storageMethods.proxyDownload(
        repo,
        'https://packagist.org/p2/vendor/pkg.json',
        'vendor/pkg',
        '1.0.0',
      );

      expect(mockProxyHelper).toHaveBeenCalledTimes(2);
    });

    it('should serve cache on HEAD request failure', async () => {
      const cachedData = Buffer.from('cached');
      mockStorage.get.mockResolvedValue(cachedData);
      mockProxyHelper.mockRejectedValue(new Error('Network error'));

      const result = await storageMethods.proxyDownload(
        repo,
        'https://packagist.org/p2/vendor/pkg.json',
        'vendor/pkg',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(cachedData);
    });

    it('should respect cache disabled config', async () => {
      const noCacheRepo = { ...repo, config: { cacheEnabled: false } };
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: Buffer.from('data'),
      });

      await storageMethods.proxyDownload(
        noCacheRepo as any,
        'https://packagist.org/p2/vendor/pkg.json',
        'vendor/pkg',
        '1.0.0',
      );

      expect(mockStorage.get).not.toHaveBeenCalled();
    });
  });

  describe('download', () => {
    const repo: Repository = {
      id: 'r1',
      type: 'hosted',
      name: 'my-repo',
      config: {},
    } as any;

    it('should download from hosted repo', async () => {
      const data = Buffer.from('package data');
      mockStorage.get.mockResolvedValue(data);

      const result = await storageMethods.download(repo, 'vendor/pkg', '1.0.0');

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(data);
    });

    it('should generate packages.json for hosted repo', async () => {
      mockStorage.list.mockResolvedValue([
        'composer/r1/vendor/pkg/1.0.0.zip',
        'composer/r1/vendor/pkg/2.0.0.zip',
        'composer/r1/other/lib/1.5.0.zip'
      ]);

      const result = await storageMethods.download(repo, 'packages.json');

      expect(result.ok).toBe(true);
      expect(result.contentType).toBe('application/json');
      const packages = JSON.parse(result.data.toString());
      expect(packages.packages).toBeDefined();
      expect(packages.packages['vendor/pkg']).toBeDefined();
      expect(packages.packages['vendor/pkg']['1.0.0']).toBeDefined();
    });

    it('should handle packages.json generation errors gracefully', async () => {
      mockStorage.list.mockRejectedValue(new Error('list failed'));

      const result = await storageMethods.download(repo, 'packages.json');

      expect(result.ok).toBe(true);
      const packages = JSON.parse(result.data.toString());
      expect(packages.packages).toEqual({});
    });

    it('should handle group repo download', async () => {
      const groupRepo = {
        type: 'group',
        config: { members: ['host1'] },
      };
      const hostedRepo = { id: 'host1', type: 'hosted', name: 'hosted' };
      (mockContext.getRepo as jest.Mock).mockResolvedValue(hostedRepo);
      mockStorage.get.mockResolvedValue(Buffer.from('data'));

      const result = await storageMethods.download(
        groupRepo as any,
        'vendor/pkg',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
    });

    it('should handle proxy repo download', async () => {
      const proxyRepo = {
        ...repo,
        type: 'proxy',
        config: { proxyUrl: 'https://packagist.org' },
      };
      // Mock proxyDownload method
      const mockProxyDownload = jest.fn().mockResolvedValue({
        ok: true,
        data: Buffer.from('data'),
      });
      storageMethods.proxyDownload = mockProxyDownload;

      const result = await storageMethods.download(
        proxyRepo as any,
        'vendor/pkg',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
    });

    it('should return not found for missing package', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await storageMethods.download(
        repo,
        'vendor/missing',
        '1.0.0',
      );

      expect(result.ok).toBe(false);
      expect(result.message.toLowerCase()).toContain('not found');
    });
  });
});
