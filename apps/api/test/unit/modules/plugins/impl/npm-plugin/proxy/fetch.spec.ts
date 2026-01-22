/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { initProxy } from 'src/modules/plugins/impl/npm-plugin/proxy/fetch';
import { Repository } from 'src/modules/plugins/impl/npm-plugin/utils/types';

jest.mock('src/modules/plugins/impl/npm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/modules/plugins/impl/npm-plugin/proxy/metadata', () => ({
  initMetadata: jest.fn(() => ({
    processMetadata: jest.fn((repo, data) => data),
  })),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  proxyFetchWithAuth: jest.fn(),
}));

describe('NpmPlugin Proxy Fetch', () => {
  let mockStorage: any;
  let mockContext: any;
  let proxyMethods: ReturnType<typeof initProxy>;
  let mockProxyFetchWithAuth: jest.Mock;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
      save: jest.fn().mockResolvedValue({ ok: true }),
      getMetadata: jest.fn().mockResolvedValue(null),
    };
    mockContext = {
      storage: mockStorage,
      indexArtifact: jest.fn(),
    };

    mockProxyFetchWithAuth = require('src/plugins-core/proxy-helper')
      .proxyFetchWithAuth as jest.Mock;

    proxyMethods = initProxy(mockContext);
    jest.clearAllMocks();
  });

  describe('proxyFetch', () => {
    const repo: Repository = {
      id: 'r1',
      type: 'proxy',
      name: 'npm-repo',
      config: { cacheEnabled: true, cacheMaxAgeDays: 7 },
    } as any;

    it('should return cached tarball on cache hit', async () => {
      const cachedData = Buffer.from('cached tarball');
      mockStorage.get.mockResolvedValue(cachedData);
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-length': String(cachedData.length) },
      });

      const result = await proxyMethods.proxyFetch(repo, 'pkg/-/pkg-1.0.0.tgz');

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
      expect((result as any).body).toEqual(cachedData);
    });

    it('should return cached metadata on cache hit', async () => {
      const metadata = JSON.stringify({ name: 'test-pkg', versions: {} });
      mockStorage.get.mockResolvedValue(Buffer.from(metadata));
      mockStorage.getMetadata.mockResolvedValue({
        mtime: new Date(),
        size: 100,
      });

      const result = await proxyMethods.proxyFetch(repo, 'test-pkg');

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
      expect(result.headers?.['content-type']).toBe('application/json');
    });

    it('should fetch from upstream on cache miss', async () => {
      mockStorage.get.mockResolvedValue(null);
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { name: 'test-pkg' },
      });

      const result = await proxyMethods.proxyFetch(repo, 'test-pkg');

      expect(result.ok).toBe(true);
      expect(mockProxyFetchWithAuth).toHaveBeenCalled();
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should cache tarball and index artifact', async () => {
      mockStorage.get.mockResolvedValue(null);
      const tarballData = Buffer.from('tarball content');
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
        body: tarballData,
      });

      const result = await proxyMethods.proxyFetch(repo, 'pkg/-/pkg-1.0.0.tgz');

      expect(result.ok).toBe(true);
      expect(mockStorage.save).toHaveBeenCalled();
      expect(mockContext.indexArtifact).toHaveBeenCalled();
    });

    it('should handle upstream fetch failure', async () => {
      mockStorage.get.mockResolvedValue(null);
      mockProxyFetchWithAuth.mockRejectedValue(new Error('Network error'));

      const result = await proxyMethods.proxyFetch(repo, 'test-pkg');

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('should serve cache on revalidation failure', async () => {
      const cachedData = Buffer.from('cached tarball');
      mockStorage.get.mockResolvedValue(cachedData);
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const result = await proxyMethods.proxyFetch(repo, 'pkg/-/pkg-1.0.0.tgz');

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    });

    it('should handle URL canonicalization', async () => {
      mockStorage.get.mockResolvedValue(null);
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: {},
      });

      const fullUrl = 'http://localhost:3000/repository/npm-repo/test-pkg';
      await proxyMethods.proxyFetch(repo, fullUrl);

      expect(mockProxyFetchWithAuth).toHaveBeenCalled();
    });

    it('should respect cache disabled config', async () => {
      const noCacheRepo = { ...repo, config: { cacheEnabled: false } };
      mockStorage.get.mockResolvedValue(Buffer.from('cached'));
      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        body: {},
      });

      await proxyMethods.proxyFetch(noCacheRepo as any, 'test-pkg');

      // Should not return cache even if available
      expect(mockProxyFetchWithAuth).toHaveBeenCalled();
    });

    it('should re-fetch metadata from upstream if cache is expired', async () => {
      const metadata = JSON.stringify({ name: 'test-pkg', versions: {} });
      mockStorage.get.mockResolvedValue(Buffer.from(metadata));

      const oldDate = new Date();
      oldDate.setMinutes(oldDate.getMinutes() - 10); // 10 mins old

      mockStorage.getMetadata.mockResolvedValue({
        mtime: oldDate,
        size: 100
      });

      const cachedRepo = {
        ...repo,
        config: { ...repo.config, cacheTtlSeconds: 300 }
      } as any;

      mockProxyFetchWithAuth.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: { name: 'test-pkg', version: 'updated' },
      });

      const result = await proxyMethods.proxyFetch(cachedRepo, 'test-pkg');

      expect(mockProxyFetchWithAuth).toHaveBeenCalled();
      expect((result as any).body).toEqual({ name: 'test-pkg', version: 'updated' });
    });
  });
});
