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

import { initProxy } from 'src/modules/plugins/impl/pypi-plugin/proxy/fetch';
import { buildKey } from 'src/modules/plugins/impl/pypi-plugin/utils/key-utils';
import proxyFetchWithAuth from 'src/plugins-core/proxy-helper';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/pypi-plugin/utils/types';

jest.mock('src/modules/plugins/impl/pypi-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args: string[]) => args.join('/')),
}));

const processSimpleIndex = jest.fn(
  (repo: Repository, html: string) => `${repo.name}:${html}`,
);

jest.mock('src/modules/plugins/impl/pypi-plugin/proxy/metadata', () => ({
  initMetadata: jest.fn(() => ({
    processSimpleIndex,
  })),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('PyPIPlugin proxy fetch', () => {
  const indexArtifact = jest.fn();
  const storage = {
    get: jest.fn<Promise<Buffer | null>, [string]>(),
    save: jest.fn<Promise<{ ok: true }>, [string, Buffer]>(),
  };
  const context = {
    storage,
    indexArtifact,
  } as unknown as PluginContext;
  const repo = {
    id: 'r1',
    name: 'pypi-proxy',
    type: 'proxy',
    config: { cacheEnabled: true, cacheMaxAgeDays: 7 },
  } as Repository;
  const proxyHelperMock = proxyFetchWithAuth as jest.MockedFunction<
    typeof proxyFetchWithAuth
  >;
  const buildKeyMock = buildKey as jest.MockedFunction<typeof buildKey>;

  beforeEach(() => {
    jest.clearAllMocks();
    buildKeyMock.mockImplementation((...args: string[]) => args.join('/'));
    storage.save.mockResolvedValue({ ok: true });
  });

  it('serves cached metadata and rewrites it on cache hit fallback', async () => {
    storage.get.mockResolvedValueOnce(Buffer.from('<a href="x">pkg</a>'));
    proxyHelperMock.mockResolvedValueOnce({ ok: false, status: 503 });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'simple/demo/')) as {
      ok: boolean;
      body?: unknown;
      headers?: Record<string, string>;
    };

    expect(result.ok).toBe(true);
    expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    expect(result.body).toBe('pypi-proxy:<a href="x">pkg</a>');
    expect(processSimpleIndex).toHaveBeenCalledWith(
      repo,
      '<a href="x">pkg</a>',
      'simple/demo/',
    );
  });

  it('downloads and indexes magic proxy packages on cache miss', async () => {
    const packageBody = Buffer.from('wheel-content');

    storage.get.mockResolvedValueOnce(null);
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: packageBody,
      headers: { 'content-type': 'application/octet-stream' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fdemo-1.0.0.whl',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(result.body).toEqual(packageBody);
    expect(storage.save).toHaveBeenCalledWith(
      'pypi/r1/proxy/demo/demo-1.0.0.whl',
      packageBody,
    );
    expect(indexArtifact).toHaveBeenCalledTimes(1);
    const [, artifact] = indexArtifact.mock.calls[0] as [
      Repository,
      {
        metadata: {
          name: string;
          version: string;
          filename: string;
          size: number;
        };
      },
    ];
    expect(artifact.metadata.name).toBe('demo');
    expect(artifact.metadata.version).toBe('1.0.0');
    expect(artifact.metadata.filename).toBe('demo-1.0.0.whl');
    expect(artifact.metadata.size).toBe(packageBody.length);
  });

  it('warns and falls back to the magic cache key when canonical key derivation fails', async () => {
    const packageBody = Buffer.from('wheel-content');
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    buildKeyMock
      .mockImplementationOnce(() => {
        throw new Error('key fail');
      })
      .mockImplementation((...args: string[]) => args.join('/'));

    storage.get.mockResolvedValueOnce(null);
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: packageBody,
      headers: { 'content-type': 'application/octet-stream' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fdemo-1.0.0.whl',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(result.body).toEqual(packageBody);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to derive canonical proxy cache key'),
    );
    expect(storage.save).toHaveBeenCalledWith(
      'pypi/r1/proxy/magic/https://files.pythonhosted.org/packages/demo-1.0.0.whl',
      packageBody,
    );

    warnSpy.mockRestore();
  });

  it('derives hyphenated package names correctly for source distributions', async () => {
    const packageBody = Buffer.from('sdist-content');

    storage.get.mockResolvedValueOnce(null);
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: packageBody,
      headers: { 'content-type': 'application/octet-stream' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fmy-package-1.2.3.tar.gz',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      'pypi/r1/proxy/my-package/my-package-1.2.3.tar.gz',
      packageBody,
    );
    const [, artifact] = indexArtifact.mock.calls[0] as [
      Repository,
      { metadata: { name: string; version: string; filename: string } },
    ];
    expect(artifact.metadata.name).toBe('my-package');
    expect(artifact.metadata.version).toBe('1.2.3');
    expect(artifact.metadata.filename).toBe('my-package-1.2.3.tar.gz');
  });

  it('indexes standard proxied package files with parsed package identity', async () => {
    const packageBody = Buffer.from('wheel-content');

    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: packageBody,
      headers: { 'content-type': 'application/octet-stream' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'packages/demo-2.5.1.whl')) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      'pypi/r1/proxy/file/packages/demo-2.5.1.whl',
      packageBody,
    );
    const [, artifact] = indexArtifact.mock.calls[0] as [
      Repository,
      {
        ok: boolean;
        id: string;
        metadata: {
          name: string;
          version: string;
          filename: string;
          storageKey: string;
        };
      },
    ];
    expect(artifact.id).toBe('demo:2.5.1');
    expect(artifact.metadata.name).toBe('demo');
    expect(artifact.metadata.version).toBe('2.5.1');
    expect(artifact.metadata.filename).toBe('demo-2.5.1.whl');
    expect(artifact.metadata.storageKey).toBe(
      'pypi/r1/proxy/file/packages/demo-2.5.1.whl',
    );
  });

  it('normalizes full local simple-index urls before upstream fetch and cache', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: '<a href="demo-1.0.0.whl">demo</a>',
      headers: { 'content-type': 'text/html' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'http://localhost:3000/repository/pypi-proxy/simple/demo/',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(proxyHelperMock).toHaveBeenCalledWith(repo, 'simple/demo/');
    expect(storage.save).toHaveBeenCalledWith(
      'pypi/r1/proxy/metadata/simple/demo/',
      Buffer.from('<a href="demo-1.0.0.whl">demo</a>'),
    );
    expect(processSimpleIndex).toHaveBeenCalledWith(
      repo,
      '<a href="demo-1.0.0.whl">demo</a>',
      'simple/demo/',
    );
  });
});
