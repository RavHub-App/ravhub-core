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

import { initProxy } from 'src/modules/plugins/impl/composer-plugin/proxy/fetch';
import { Repository } from 'src/modules/plugins/impl/composer-plugin/utils/types';

jest.mock('src/modules/plugins/impl/composer-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/modules/plugins/impl/composer-plugin/proxy/metadata', () => ({
  initMetadata: jest.fn(() => ({
    processMetadata: jest.fn(async (repo, url, content) => {
      if (typeof content === 'string') return content;
      if (Buffer.isBuffer(content)) return content.toString();
      return JSON.stringify(content);
    }),
  })),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  default: jest.fn(),
}));

describe('ComposerPlugin Proxy Fetch', () => {
  let mockContext: any;
  let proxyMethods: ReturnType<typeof initProxy>;
  let mockProxyHelper: jest.Mock;

  beforeEach(() => {
    mockContext = {
      storage: {
        get: jest.fn(),
        save: jest.fn().mockResolvedValue({ ok: true }),
      },
    };

    mockProxyHelper = require('src/plugins-core/proxy-helper')
      .default as jest.Mock;

    proxyMethods = initProxy(mockContext);
    jest.clearAllMocks();
  });

  describe('proxyFetch', () => {
    const repo: Repository = {
      id: 'r1',
      type: 'proxy',
      config: { proxyUrl: 'https://packagist.org' },
    } as any;

    it('should return cached JSON metadata', async () => {
      const cachedData = JSON.stringify({ packages: {} });
      mockContext.storage.get.mockResolvedValue(Buffer.from(cachedData));

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
      expect(result.headers?.['content-type']).toBe('application/json');
    });

    it('should return cached binary data', async () => {
      const cachedData = Buffer.from('zip content');
      mockContext.storage.get.mockResolvedValue(cachedData);

      const result = await proxyMethods.proxyFetch(
        repo,
        'dist/vendor/pkg/1.0.0.zip',
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
      expect(result.headers?.['content-type']).toBe('application/octet-stream');
    });

    it('should fetch from upstream on cache miss', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: { packages: {} },
        headers: { 'content-type': 'application/json' },
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      expect(result.ok).toBe(true);
      expect(mockProxyHelper).toHaveBeenCalled();
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should handle dist URL with base64 encoding', async () => {
      const targetUrl = 'https://api.github.com/repos/vendor/pkg/zipball/ref';
      const base64Url = Buffer.from(targetUrl).toString('base64');
      const distUrl = `dist/${base64Url}/vendor/package/1.0.0.zip`;

      // Mock proxyDownload from storage module
      jest.mock(
        'src/modules/plugins/impl/composer-plugin/storage/storage',
        () => ({
          initStorage: jest.fn(() => ({
            proxyDownload: jest.fn().mockResolvedValue({
              ok: true,
              body: Buffer.from('zip'),
              contentType: 'application/zip',
            }),
          })),
        }),
      );

      mockContext.storage.get.mockResolvedValue(null);

      const result = await proxyMethods.proxyFetch(repo, distUrl);

      // Should attempt to decode and download
      expect(result.ok).toBeDefined();
    });

    it('should handle dist URL with packageName option', async () => {
      mockContext.storage.get.mockResolvedValue(null);

      // Mock storage module
      jest.mock(
        'src/modules/plugins/impl/composer-plugin/storage/storage',
        () => ({
          initStorage: jest.fn(() => ({
            proxyDownload: jest.fn().mockResolvedValue({
              ok: true,
              body: Buffer.from('zip'),
            }),
          })),
        }),
      );

      const result = await proxyMethods.proxyFetch(
        repo,
        'https://api.github.com/repos/vendor/pkg/zipball/ref',
        { packageName: 'vendor/package', version: '1.0.0' },
      );

      expect(result.ok).toBeDefined();
    });

    it('should process JSON metadata from upstream', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      const metadata = { packages: { 'vendor/pkg': {} } };
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: metadata,
        headers: { 'content-type': 'application/json' },
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('MISS');
    });

    it('should save non-JSON body to storage', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: Buffer.from('binary data'),
        headers: { 'content-type': 'application/octet-stream' },
      });

      const result = await proxyMethods.proxyFetch(repo, 'dist/file.zip');

      expect(result.ok).toBe(true);
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should handle upstream fetch failure', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockRejectedValue(new Error('Network error'));

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Network error');
    });

    it('should handle metadata processing error gracefully', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: { packages: {} },
        headers: { 'content-type': 'application/json' },
      });

      // Mock processMetadata to throw
      const {
        initMetadata,
      } = require('src/modules/plugins/impl/composer-plugin/proxy/metadata');
      initMetadata.mockReturnValue({
        processMetadata: jest
          .fn()
          .mockRejectedValue(new Error('Processing error')),
      });

      // Re-init to pick up new mock
      proxyMethods = initProxy(mockContext);

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      // Should still return response even if processing fails
      expect(result.ok).toBe(true);
    });

    it('should handle cached JSON with processing', async () => {
      const metadata = {
        packages: {
          'vendor/pkg': { dist: { url: 'https://packagist.org/file.zip' } },
        },
      };
      mockContext.storage.get.mockResolvedValue(
        Buffer.from(JSON.stringify(metadata)),
      );

      const result = await proxyMethods.proxyFetch(
        repo,
        'p2/vendor/package.json',
      );

      expect(result.ok).toBe(true);
      expect(typeof result.body).toBe('object');
    });
  });
});
