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

import { initProxy } from 'src/modules/plugins/impl/helm-plugin/proxy/fetch';
import * as yaml from 'js-yaml';

jest.mock('src/modules/plugins/impl/helm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('HelmPlugin Proxy Fetch', () => {
  let mockContext: any;
  let proxyMethods: ReturnType<typeof initProxy>;
  let mockProxyHelper: jest.Mock;

  beforeEach(() => {
    mockContext = {
      storage: {
        get: jest.fn(),
        save: jest.fn().mockResolvedValue({ ok: true }),
      },
      indexArtifact: jest.fn(),
    };

    mockProxyHelper = require('src/plugins-core/proxy-helper')
      .default as jest.Mock;

    proxyMethods = initProxy(mockContext);
    jest.clearAllMocks();
  });

  describe('magic proxy path (helm-proxy/)', () => {
    const repo = { id: 'r1', config: { cacheEnabled: true } };

    it('should decode base64 URL and fetch from upstream', async () => {
      const targetUrl = 'https://charts.example.com/chart-1.0.0.tgz';
      const base64Url = Buffer.from(targetUrl).toString('base64');
      const chartData = Buffer.from('chart content');

      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: chartData,
        headers: {},
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        `helm-proxy/${base64Url}`,
      );

      expect(result.ok).toBe(true);
      expect(result.body).toEqual(chartData);
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should return cached data on cache hit', async () => {
      const targetUrl = 'https://charts.example.com/chart-1.0.0.tgz';
      const base64Url = Buffer.from(targetUrl).toString('base64');
      const cachedData = Buffer.from('cached chart');

      mockContext.storage.get.mockResolvedValue(cachedData);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        headers: { 'content-length': String(cachedData.length) },
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        `helm-proxy/${base64Url}`,
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
      expect(result.body).toEqual(cachedData);
    });

    it('should serve cache on revalidation failure', async () => {
      const targetUrl = 'https://charts.example.com/chart-1.0.0.tgz';
      const base64Url = Buffer.from(targetUrl).toString('base64');
      const cachedData = Buffer.from('cached');

      mockContext.storage.get.mockResolvedValue(cachedData);
      mockProxyHelper.mockRejectedValue(new Error('Network error'));

      const result = await proxyMethods.proxyFetch(
        repo,
        `helm-proxy/${base64Url}`,
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    });

    it('should index artifact after caching', async () => {
      const targetUrl = 'https://charts.example.com/nginx-1.2.3.tgz';
      const base64Url = Buffer.from(targetUrl).toString('base64');

      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: Buffer.from('chart'),
        headers: {},
      });

      await proxyMethods.proxyFetch(repo, `helm-proxy/${base64Url}`);

      expect(mockContext.indexArtifact).toHaveBeenCalledWith(
        repo,
        expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'nginx',
            version: '1.2.3',
          }),
        }),
      );
    });
  });

  describe('standard chart downloads (.tgz)', () => {
    const repo = {
      id: 'r1',
      config: { proxyUrl: 'https://charts.helm.sh', cacheEnabled: true },
    };

    it('should fetch chart from upstream', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      const chartData = Buffer.from('chart data');
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: chartData,
        headers: {},
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        'stable/nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(true);
      expect(mockProxyHelper).toHaveBeenCalled();
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should return cached chart', async () => {
      const cachedData = Buffer.from('cached chart');
      mockContext.storage.get.mockResolvedValue(cachedData);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        headers: { 'content-length': String(cachedData.length) },
      });

      const result = await proxyMethods.proxyFetch(
        repo,
        'stable/nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(true);
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    });

    it('should redownload on size mismatch', async () => {
      const cachedData = Buffer.from('old');
      mockContext.storage.get.mockResolvedValue(cachedData);
      mockProxyHelper
        .mockResolvedValueOnce({
          ok: true,
          headers: { 'content-length': '999' },
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          body: Buffer.from('new data'),
          headers: {},
        });

      await proxyMethods.proxyFetch(repo, 'stable/nginx-1.0.0.tgz');

      expect(mockProxyHelper).toHaveBeenCalledTimes(2);
    });
  });

  describe('index.yaml handling', () => {
    const repo = {
      id: 'r1',
      config: { proxyUrl: 'https://charts.helm.sh', cacheEnabled: true },
    };

    it('should rewrite URLs in index.yaml from upstream', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      const indexData = {
        entries: {
          nginx: [
            {
              version: '1.0.0',
              urls: ['https://charts.example.com/nginx-1.0.0.tgz'],
            },
          ],
        },
      };

      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: Buffer.from(yaml.dump(indexData)),
        headers: {},
      });

      const result = await proxyMethods.proxyFetch(repo, 'index.yaml');

      expect(result.ok).toBe(true);
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should rewrite cached index.yaml URLs', async () => {
      const indexData = {
        entries: {
          nginx: [
            {
              version: '1.0.0',
              urls: ['https://charts.example.com/nginx-1.0.0.tgz'],
            },
          ],
        },
      };
      mockContext.storage.get.mockResolvedValue(
        Buffer.from(yaml.dump(indexData)),
      );

      const result = await proxyMethods.proxyFetch(repo, 'index.yaml');

      expect(result.ok).toBe(true);
      expect(result.headers?.['content-type']).toBe('text/yaml');
      expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    });

    it('should handle YAML parsing errors gracefully', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: Buffer.from('invalid: yaml: ['),
        headers: {},
      });

      const result = await proxyMethods.proxyFetch(repo, 'index.yaml');

      expect(result.ok).toBe(true);
    });
  });

  describe('cache disabled', () => {
    const repo = {
      id: 'r1',
      config: { proxyUrl: 'https://charts.helm.sh', cacheEnabled: false },
    };

    it('should not use cache when disabled', async () => {
      mockProxyHelper.mockResolvedValue({
        ok: true,
        status: 200,
        body: Buffer.from('data'),
        headers: {},
      });

      await proxyMethods.proxyFetch(repo, 'stable/nginx-1.0.0.tgz');

      expect(mockContext.storage.get).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    const repo = { id: 'r1', config: { proxyUrl: 'https://charts.helm.sh' } };

    it('should handle upstream fetch failure', async () => {
      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: false,
        status: 404,
      });

      const result = await proxyMethods.proxyFetch(repo, 'stable/missing.tgz');

      expect(result.ok).toBe(false);
    });
  });
});
