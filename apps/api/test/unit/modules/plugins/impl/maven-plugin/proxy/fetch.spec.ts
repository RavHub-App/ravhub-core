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

import { initProxy } from 'src/modules/plugins/impl/maven-plugin/proxy/fetch';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/maven-plugin/utils/types';
import * as proxyHelper from 'src/plugins-core/proxy-helper';

// Mocks
jest.mock('src/plugins-core/proxy-helper', () => ({
  proxyFetchWithAuth: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/maven-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));
jest.mock('src/modules/plugins/impl/maven-plugin/utils/maven', () => ({
  ...jest.requireActual('src/modules/plugins/impl/maven-plugin/utils/maven'),
  parseMetadata: jest.fn(),
  resolveSnapshotVersion: jest.fn(),
}));

const mockParseMetadata =
  require('src/modules/plugins/impl/maven-plugin/utils/maven').parseMetadata;
const mockResolveSnapshotVersion =
  require('src/modules/plugins/impl/maven-plugin/utils/maven').resolveSnapshotVersion;
const mockProxyFetch = proxyHelper.proxyFetchWithAuth as jest.Mock;

describe('MavenPlugin Proxy Fetch', () => {
  let context: PluginContext;
  let proxyFetch: any;
  const repo: Repository = {
    id: 'r1',
    name: 'maven-proxy',
    config: { url: 'https://repo1.maven.org/maven2' },
  } as any;

  beforeEach(() => {
    context = {
      storage: {
        get: jest.fn(),
        save: jest.fn(),
        exists: jest.fn(),
      } as any,
    } as any;
    proxyFetch = initProxy(context).proxyFetch;
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.warn as jest.Mock).mockRestore();
  });

  it('should fetch from upstream if cache miss', async () => {
    (context.storage.get as jest.Mock).mockResolvedValue(null);
    mockProxyFetch.mockResolvedValue({
      ok: true,
      body: Buffer.from('content'),
      headers: { 'content-type': 'application/java-archive' },
    });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );

    expect(result.ok).toBe(true);
    expect(context.storage.save).toHaveBeenCalled();
    expect(mockProxyFetch).toHaveBeenCalledWith(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );
  });

  it('should serve from cache if available (HIT)', async () => {
    const cachedContent = Buffer.from('cached-content');
    (context.storage.get as jest.Mock).mockResolvedValue(cachedContent);

    // Mock HEAD request to return same content length
    mockProxyFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { 'content-length': cachedContent.length.toString() },
    });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );

    expect(result.ok).toBe(true);
    expect(result.headers['x-proxy-cache']).toBe('HIT');
    expect(context.storage.save).not.toHaveBeenCalled();
  });

  it('should revalidate cache and fetch upstream if size differs', async () => {
    const cachedContent = Buffer.from('old-content');
    (context.storage.get as jest.Mock).mockResolvedValue(cachedContent);

    // Mock HEAD request to return different content length
    mockProxyFetch.mockImplementation(async (r: any, u: string, opts: any) => {
      if (opts?.method === 'HEAD') {
        return { ok: true, status: 200, headers: { 'content-length': '9999' } };
      }
      return { ok: true, body: Buffer.from('new-content'), headers: {} };
    });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );

    expect(result.ok).toBe(true);
    expect(result.body.toString()).toBe('new-content');
    expect(context.storage.save).toHaveBeenCalled();
  });

  it('should handle SNAPSHOT resolution', async () => {
    const snapshotUrl = 'com/example/lib/1.0.0-SNAPSHOT/lib-1.0.0-SNAPSHOT.jar';

    // Mock maven-metadata.xml fetch
    mockProxyFetch.mockImplementation(async (r: any, url: string) => {
      if (url.endsWith('maven-metadata.xml')) {
        return { ok: true, body: '<metadata>...</metadata>' };
      }
      if (url.includes('1.0.0-20230101.120000-1')) {
        return { ok: true, body: 'resolved-snapshot-content' };
      }
      return { ok: false };
    });

    mockParseMetadata.mockReturnValue({});
    mockResolveSnapshotVersion.mockReturnValue('1.0.0-20230101.120000-1');

    const result = await proxyFetch(repo, snapshotUrl);

    expect(result.ok).toBe(true);
    expect(result.body).toBe('resolved-snapshot-content');
    expect(mockResolveSnapshotVersion).toHaveBeenCalled();
  });

  it('should correctly extract metadata for valid artifacts', async () => {
    (context.storage.get as jest.Mock).mockResolvedValue(null);
    mockProxyFetch.mockResolvedValue({
      ok: true,
      body: Buffer.from('jar-content'),
    });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );

    expect(result.metadata).toBeDefined();
    expect(result.metadata.name).toBe('com.example/lib');
    expect(result.metadata.version).toBe('1.0.0');
  });

  it('should NOT extract metadata for checksums/metadata files', async () => {
    (context.storage.get as jest.Mock).mockResolvedValue(null);
    mockProxyFetch.mockResolvedValue({ ok: true, body: Buffer.from('sha1') });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar.sha1',
    );

    expect(result.metadata).toBeUndefined();
  });

  it('should handle upstream errors', async () => {
    (context.storage.get as jest.Mock).mockResolvedValue(null);
    mockProxyFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await proxyFetch(repo, 'com/example/lib/1.0.0/missing.jar');

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
  });

  it('should use fallback cache if revalidation fails', async () => {
    const cachedContent = Buffer.from('cached');
    (context.storage.get as jest.Mock).mockResolvedValue(cachedContent);

    mockProxyFetch.mockImplementation(async (r: any, u: string, opts: any) => {
      if (opts?.method === 'HEAD') throw new Error('Network Error');
      return { ok: true };
    });

    const result = await proxyFetch(
      repo,
      'com/example/lib/1.0.0/lib-1.0.0.jar',
    );

    expect(result.ok).toBe(true);
    expect(result.headers['x-proxy-cache']).toBe('HIT');
  });
});
