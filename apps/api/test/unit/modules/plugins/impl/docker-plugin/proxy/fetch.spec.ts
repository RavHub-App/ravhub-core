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
  initProxyFetch,
  proxyFetch,
  pingUpstream,
} from 'src/modules/plugins/impl/docker-plugin/proxy/fetch';
import type { Repository } from 'src/modules/plugins/impl/docker-plugin/utils/types';
import * as proxyHelperModule from 'src/plugins-core/proxy-helper';

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('DockerPlugin Proxy Fetch', () => {
  let mockStorage: any;
  let mockIndexArtifact: any;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
      save: jest.fn(),
      saveStream: jest.fn(),
    };
    mockIndexArtifact = jest.fn();

    initProxyFetch({ storage: mockStorage, indexArtifact: mockIndexArtifact });
    jest.clearAllMocks();
  });

  describe('proxyFetch', () => {
    it('should fetch from upstream', async () => {
      const mockFetch = proxyHelperModule.default as jest.Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: { 'content-type': 'application/json' },
        body: Buffer.from('{}'),
      });

      const repo: Repository = {
        id: 'r1',
        config: { docker: { proxyUrl: 'http://up' } },
      } as any;
      const result = await proxyFetch(repo, 'http://up/v2/');

      expect(mockFetch).toHaveBeenCalledWith(
        repo,
        'http://up/v2/',
        expect.anything(),
      );
      expect(result.ok).toBe(true);
    });

    // Add more scenarios: 401 handling, caching, etc.
  });

  describe('pingUpstream', () => {
    it('should ping upstream', async () => {
      const mockFetch = proxyHelperModule.default as jest.Mock;
      mockFetch.mockResolvedValue({ ok: true, status: 200 });

      const repo: Repository = {
        id: 'r1',
        config: { docker: { proxyUrl: 'http://up' } },
      } as any;
      const result = await pingUpstream(repo, {} as any);

      expect(result.ok).toBe(true);
    });
  });
});
