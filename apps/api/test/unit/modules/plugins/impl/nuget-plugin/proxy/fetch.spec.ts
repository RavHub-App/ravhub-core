/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

import { initProxy } from 'src/modules/plugins/impl/nuget-plugin/proxy/fetch';
import proxyFetchWithAuth, {
  ProxyFetchResult,
} from 'src/plugins-core/proxy-helper';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/nuget-plugin/utils/types';

jest.mock('src/modules/plugins/impl/nuget-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args: string[]) => args.join('/')),
}));

const processServiceIndex = jest.fn(
  (repo: Repository, body: Buffer | string) => ({
    rewrittenBy: repo.name,
    raw: Buffer.isBuffer(body) ? body.toString() : body,
  }),
);

jest.mock('src/modules/plugins/impl/nuget-plugin/proxy/metadata', () => ({
  initMetadata: jest.fn(() => ({
    processServiceIndex,
  })),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('NuGetPlugin proxy fetch', () => {
  const storage = {
    get: jest.fn<Promise<Buffer | null>, [string]>(),
    save: jest.fn<Promise<{ ok: true }>, [string, Buffer]>(),
  };
  const indexArtifact = jest.fn();
  const context = {
    storage,
    indexArtifact,
  } as unknown as PluginContext;
  const repo = {
    id: 'r1',
    name: 'nuget-proxy',
    type: 'proxy',
    manager: 'nuget',
    config: {
      proxyUrl: 'https://api.nuget.org/v3/index.json',
      cacheEnabled: true,
      cacheMaxAgeDays: 7,
    },
  } as Repository;
  const proxyHelperMock = proxyFetchWithAuth as jest.MockedFunction<
    typeof proxyFetchWithAuth
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    storage.save.mockResolvedValue({ ok: true });
  });

  it('rewrites cached index.json through processServiceIndex', async () => {
    storage.get.mockResolvedValueOnce(Buffer.from('{"version":"3.0.0"}'));

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'index.json')) as {
      ok: boolean;
      body?: unknown;
      headers?: Record<string, string>;
    };

    expect(result.ok).toBe(true);
    expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    expect(processServiceIndex).toHaveBeenCalledTimes(1);
    expect(result.body).toEqual({
      rewrittenBy: 'nuget-proxy',
      raw: '{"version":"3.0.0"}',
    });
  });

  it('serves cached nupkg when HEAD revalidation fails', async () => {
    const cached = Buffer.from('cached package');

    storage.get.mockResolvedValueOnce(cached);
    proxyHelperMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
    } as ProxyFetchResult);

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'demo/1.2.3/demo.1.2.3.nupkg')) as {
      ok: boolean;
      body?: unknown;
      headers?: Record<string, string>;
    };

    expect(result.ok).toBe(true);
    expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    expect(result.body).toEqual(cached);
    expect(proxyHelperMock).toHaveBeenCalledWith(
      repo,
      'https://api.nuget.org/v3-flatcontainer/demo/1.2.3/demo.1.2.3.nupkg',
      {
        method: 'HEAD',
        timeoutMs: 5000,
      },
    );
  });

  it('fetches encoded v3-proxy metadata, caches it and rewrites index responses', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: '{"version":"3.0.0"}',
    } as ProxyFetchResult);

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer/index.json',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(proxyHelperMock).toHaveBeenCalledWith(
      repo,
      'https://api.nuget.org/v3-flatcontainer/index.json',
      { stream: false },
    );
    expect(storage.save).toHaveBeenCalledWith(
      'nuget/r1/proxy/https://api.nuget.org/v3-flatcontainer/index.json',
      Buffer.from('{"version":"3.0.0"}'),
    );
    expect(result.ok).toBe(true);
    expect(result.body).toEqual({
      rewrittenBy: 'nuget-proxy',
      raw: '{"version":"3.0.0"}',
    });
  });

  it('fetches nupkg, saves canonical key and indexes the artifact', async () => {
    const packageBody = Buffer.from('nupkg-content');

    storage.get.mockResolvedValueOnce(null);
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: packageBody,
    } as ProxyFetchResult);

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'demo/1.2.3/demo.1.2.3.nupkg')) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(result.body).toEqual(packageBody);
    expect(storage.save).toHaveBeenCalledWith(
      'nuget/r1/proxy/demo/1.2.3/demo.1.2.3.nupkg',
      packageBody,
    );
    expect(indexArtifact).toHaveBeenCalledTimes(1);
    const [, artifact] = indexArtifact.mock.calls[0] as [
      Repository,
      {
        id: string;
        metadata: {
          name: string;
          version: string;
          size: number;
          storageKey: string;
        };
      },
    ];
    expect(artifact.id).toBe('demo:1.2.3');
    expect(artifact.metadata.storageKey).toBe(
      'nuget/r1/proxy/demo/1.2.3/demo.1.2.3.nupkg',
    );
    expect(artifact.metadata.size).toBe(packageBody.length);
  });

  it('derives dotted package ids and semver versions correctly from filename fallback', async () => {
    const packageBody = Buffer.from('nupkg-content');

    storage.get.mockResolvedValueOnce(null);
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { 'content-type': 'application/octet-stream' },
      body: packageBody,
    } as ProxyFetchResult);

    const customRepo = {
      ...repo,
      config: {
        proxyUrl: 'https://packages.example.test/feed',
        cacheEnabled: true,
        cacheMaxAgeDays: 7,
      },
    } as Repository;

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      customRepo,
      'Newtonsoft.Json.13.0.3.nupkg',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      'nuget/r1/proxy/Newtonsoft.Json/13.0.3/Newtonsoft.Json.13.0.3.nupkg',
      packageBody,
    );
    const [, artifact] = indexArtifact.mock.calls[0] as [
      Repository,
      {
        id: string;
        metadata: {
          name: string;
          version: string;
          storageKey: string;
        };
      },
    ];
    expect(artifact.id).toBe('Newtonsoft.Json:13.0.3');
    expect(artifact.metadata.storageKey).toBe(
      'nuget/r1/proxy/Newtonsoft.Json/13.0.3/Newtonsoft.Json.13.0.3.nupkg',
    );
  });
});
