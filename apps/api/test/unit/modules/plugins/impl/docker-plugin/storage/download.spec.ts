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
  initDownload,
  download,
  getBlob,
} from 'src/modules/plugins/impl/docker-plugin/storage/download';
import { Repository } from 'src/modules/plugins/impl/docker-plugin/utils/types';

jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/modules/plugins/impl/docker-plugin/utils/helpers', () => ({
  normalizeImageName: jest.fn((name) => name),
}));

describe('DockerPlugin Download Storage', () => {
  let mockStorage: any;
  let mockProxyFetch: any;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
      getUrl: jest.fn(),
      exists: jest.fn(),
      save: jest.fn(),
      stream: jest.fn(),
    };
    mockProxyFetch = jest.fn();

    initDownload({
      storage: mockStorage,
      proxyFetch: mockProxyFetch,
    });
    jest.clearAllMocks();
  });

  describe('download (Manifests)', () => {
    const repo: Repository = { id: 'r1', type: 'hosted', config: {} } as any;

    it('should return cached manifest URL for hosted repo', async () => {
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.getUrl.mockResolvedValue('http://s3/manifest');

      const result = await download(repo, 'image', 'latest');
      expect(result.ok).toBe(true);
      expect(result.url).toBe('http://s3/manifest');
    });

    it('should try upstream for proxy repo', async () => {
      const proxyRepo = { ...repo, type: 'proxy', config: { proxyUrl: 'up' } };
      mockProxyFetch.mockResolvedValue({
        ok: true,
        body: { layers: [] },
        headers: {},
      });

      // If upstream succeeds, it returns data
      const result = await download(proxyRepo as any, 'image', 'latest');

      expect(mockProxyFetch).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should fallback to storage if proxy fetch fails', async () => {
      const proxyRepo = { ...repo, type: 'proxy', config: { proxyUrl: 'up' } };
      mockProxyFetch.mockResolvedValue({ ok: false, status: 500 }); // 500 triggers fallback
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.getUrl.mockResolvedValue('http://s3/manifest');

      const result = await download(proxyRepo as any, 'image', 'latest');

      expect(mockProxyFetch).toHaveBeenCalled();
      expect(mockStorage.exists).toHaveBeenCalled();
      expect(result.url).toBe('http://s3/manifest');
    });
    it('should return error on 4xx proxy fetch without fallback', async () => {
      const proxyRepo = { ...repo, type: 'proxy', config: { proxyUrl: 'up' } };
      mockProxyFetch.mockResolvedValue({
        ok: false,
        status: 404,
        message: 'gone',
      });
      const result = await download(proxyRepo as any, 'image', 'latest');
      expect(result.ok).toBe(false);
      expect(result.message).toBe('gone');
      expect(mockStorage.exists).not.toHaveBeenCalled();
    });

    it('should return 404 if not in storage', async () => {
      mockStorage.exists.mockResolvedValue(false);
      const result = await download(repo, 'img', 'tag');
      expect(result.ok).toBe(false);
      expect(result.message).toBe('not found');
    });
  });

  describe('getBlob', () => {
    const repo: Repository = { id: 'r1', type: 'hosted' } as any;
    it('should get blob url', async () => {
      mockStorage.exists.mockResolvedValue(true);
      mockStorage.getUrl.mockResolvedValue('http://blob');
      const result = await getBlob(repo, 'img', 'sha256:123');
      expect(result.ok).toBe(true);
      expect(result.url).toBe('http://blob');
    });

    it('should handle tag revalidation in proxy for getBlob', async () => {
      const proxyRepo = { type: 'proxy', config: { proxyUrl: 'up' } };
      mockProxyFetch.mockResolvedValue({ ok: true, url: 'http://up/manifest' });
      const result = await getBlob(proxyRepo as any, 'img', 'latest');
      expect(result.ok).toBe(true);
      expect(result.url).toBe('http://up/manifest');
    });

    it('should catch proxy fetch errors in getBlob', async () => {
      const proxyRepo = { type: 'proxy', config: { proxyUrl: 'up' } };
      mockProxyFetch.mockRejectedValue(new Error('crash'));
      mockStorage.exists.mockResolvedValue(false);
      const result = await getBlob(proxyRepo as any, 'img', 'latest');
      expect(result.ok).toBe(false);
    });

    it('should try blob endpoint if manifest fetch fails with 404', async () => {
      const proxyRepo = { type: 'proxy', config: { proxyUrl: 'up' } };
      mockStorage.exists.mockResolvedValue(false);
      mockProxyFetch
        .mockResolvedValueOnce({ ok: false, status: 404 }) // manifest fails
        .mockResolvedValueOnce({ ok: true, url: 'http://up/blob' }); // blob succeeds

      const result = await getBlob(proxyRepo as any, 'img', 'sha256:123');
      expect(result.ok).toBe(true);
      expect(result.url).toBe('http://up/blob');
      expect(mockProxyFetch).toHaveBeenCalledTimes(2);
    });
  });
});
