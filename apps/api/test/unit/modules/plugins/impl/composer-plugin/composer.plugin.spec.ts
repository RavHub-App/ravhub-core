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

import { createComposerPlugin } from 'src/modules/plugins/impl/composer-plugin/index';
import { PluginContext } from 'src/modules/plugins/impl/composer-plugin/utils/types';
import * as proxyHelperModule from 'src/plugins-core/proxy-helper';

// Mock dependencies
jest.mock('src/modules/plugins/impl/composer-plugin/auth/auth', () => ({
  authenticate: jest.fn().mockReturnValue('mockAuth'),
}));
jest.mock('src/modules/plugins/impl/composer-plugin/storage/storage', () => ({
  initStorage: jest.fn().mockReturnValue({
    upload: 'mockUpload',
    download: 'mockDownload',
    handlePut: 'mockHandlePut',
  }),
}));
jest.mock('src/modules/plugins/impl/composer-plugin/proxy/fetch', () => ({
  initProxy: jest.fn().mockReturnValue({
    proxyFetch: 'mockProxyFetch',
  }),
}));
jest.mock('src/modules/plugins/impl/composer-plugin/packages/list', () => ({
  initPackages: jest.fn().mockReturnValue({
    listVersions: 'mockListVersions',
    getInstallCommand: 'mockGetInstallCommand',
  }),
}));
jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('ComposerPlugin (Index)', () => {
  let mockContext: PluginContext;

  beforeEach(() => {
    mockContext = {
      logger: {
        debug: jest.fn(),
        error: jest.fn(),
        log: jest.fn(),
        warn: jest.fn(),
      } as any,
      repo: {} as any,
    } as any;
    jest.clearAllMocks();
  });

  it('should create plugin instance with composed methods', () => {
    const plugin = createComposerPlugin(mockContext);

    expect(plugin.metadata.key).toBe('composer');
    expect(plugin.upload).toBe('mockUpload');
    expect(plugin.download).toBe('mockDownload');
    expect(plugin.handlePut).toBe('mockHandlePut');
    expect(plugin.proxyFetch).toBe('mockProxyFetch');
    expect(plugin.listVersions).toBe('mockListVersions');
    expect(plugin.getInstallCommand).toBe('mockGetInstallCommand');
    expect(plugin.authenticate).toBeDefined();
    expect(plugin.pingUpstream).toBeDefined();
  });

  describe('pingUpstream', () => {
    it('should ping upstream successfully', async () => {
      const plugin = createComposerPlugin(mockContext);
      const mockProxyFetch = proxyHelperModule.default as jest.Mock;

      mockProxyFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      const repo = { config: { proxyUrl: 'http://test.com' } };
      const result = await plugin.pingUpstream(repo, mockContext);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(mockProxyFetch).toHaveBeenCalledWith(
        repo,
        'http://test.com',
        expect.objectContaining({ method: 'GET', maxRetries: 1 }),
      );
    });

    it('should handle ping failure (status 500)', async () => {
      const plugin = createComposerPlugin(mockContext);
      const mockProxyFetch = proxyHelperModule.default as jest.Mock;

      mockProxyFetch.mockResolvedValue({
        ok: false,
        status: 500,
        body: { message: 'Server Error' },
      });

      const repo = { config: { proxyUrl: 'http://test.com' } };
      const result = await plugin.pingUpstream(repo, mockContext);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Server Error');
    });

    it('should use default url if not configured', async () => {
      const plugin = createComposerPlugin(mockContext);
      const mockProxyFetch = proxyHelperModule.default as jest.Mock;
      mockProxyFetch.mockResolvedValue({ ok: true });

      const repo = { config: {} };
      await plugin.pingUpstream(repo, mockContext);

      expect(mockProxyFetch).toHaveBeenCalledWith(
        repo,
        'https://repo.packagist.org',
        expect.any(Object),
      );
    });

    it('should handle exceptions during ping', async () => {
      const plugin = createComposerPlugin(mockContext);
      const mockProxyFetch = proxyHelperModule.default as jest.Mock;
      mockProxyFetch.mockRejectedValue(new Error('Network fail'));

      const repo = { config: {} };
      const result = await plugin.pingUpstream(repo, mockContext);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Network fail');
    });
  });
});
