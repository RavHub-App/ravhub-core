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

import { initMetadata } from 'src/modules/plugins/impl/composer-plugin/proxy/metadata';

// Better way to mock default exports that are required dynamically
jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import proxyFetchWithAuth from 'src/plugins-core/proxy-helper';

describe('Composer Plugin - Metadata Proxy (Unit)', () => {
  let context: any;
  let metadataSvc: any;
  const repo = {
    id: 'r1',
    name: 'mycomp',
    config: { proxyUrl: 'https://packagist.org' },
  } as any;

  beforeEach(() => {
    context = { storage: {} };
    metadataSvc = initMetadata(context);
    process.env.API_HOST = 'api.local';
    process.env.API_PROTOCOL = 'https';
    jest.clearAllMocks();
  });

  describe('processMetadata', () => {
    it('should rewrite top-level URLs in packages.json', async () => {
      const input = {
        'metadata-url': '/p2/%package%.json',
        'notify-batch': 'https://packagist.org/jobs',
      };

      const resultStr = await metadataSvc.processMetadata(
        repo,
        'packages.json',
        input,
        'https://packagist.org',
      );
      const result = JSON.parse(resultStr);

      expect(result['metadata-url']).toBe(
        'https://api.local/repository/mycomp/p2/%package%.json',
      );
      expect(result['notify-batch']).toBe(
        'https://api.local/repository/mycomp/jobs',
      );
    });
  });

  describe('proxyMetadata', () => {
    it('should call upstream for metadata', async () => {
      (proxyFetchWithAuth as jest.Mock).mockResolvedValue({
        ok: true,
        body: Buffer.from('{"ok":true}'),
        headers: { 'content-type': 'application/json' },
      });

      const res = await metadataSvc.proxyMetadata(repo, 'packages.json');
      expect(res.ok).toBeTruthy();
      expect(proxyFetchWithAuth).toHaveBeenCalled();
    });

    it('should return error if no proxy URL', async () => {
      const noProxyRepo = { ...repo, config: {} };
      const res = await metadataSvc.proxyMetadata(noProxyRepo, 'packages.json');
      expect(res.ok).toBeFalsy();
      expect(res.message).toBe('No proxy URL configured');
    });
  });
});
