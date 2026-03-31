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

import { initProxy } from 'src/modules/plugins/impl/rust-plugin/proxy/fetch';
import proxyFetchWithAuth from 'src/plugins-core/proxy-helper';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/rust-plugin/utils/types';

const proxyHelperModule = jest.requireMock('src/plugins-core/proxy-helper') as {
  default?: unknown;
};

const proxyDownload = jest.fn();

jest.mock('src/modules/plugins/impl/rust-plugin/storage/storage', () => ({
  initStorage: jest.fn(() => ({
    proxyDownload,
  })),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock('src/modules/plugins/impl/rust-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args: string[]) => args.join('/')),
}));

describe('RustPlugin proxy fetch', () => {
  const storage = {
    get: jest.fn<Promise<Buffer | null>, [string]>(),
    save: jest.fn<Promise<{ ok: true }>, [string, Buffer]>(),
  };
  const context = {
    storage,
  } as unknown as PluginContext;
  const repo = {
    id: 'r1',
    name: 'rust-proxy',
    type: 'proxy',
    config: { proxyUrl: 'https://crates.example.test' },
  } as Repository;
  const proxyHelperMock = proxyFetchWithAuth as jest.MockedFunction<
    typeof proxyFetchWithAuth
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    storage.save.mockResolvedValue({ ok: true });
    proxyHelperModule.default = proxyHelperMock;
    process.env.API_HOST = 'registry.ravhub.test';
    process.env.API_PROTOCOL = 'https';
  });

  it('rewrites cached config.json dl and api endpoints', async () => {
    storage.get.mockResolvedValueOnce(
      Buffer.from(
        JSON.stringify({
          dl: 'https://static.crates.io/crates',
          api: 'https://crates.io',
        }),
      ),
    );

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'config.json')) as {
      ok: boolean;
      body?: unknown;
      headers?: Record<string, string>;
    };

    const json = JSON.parse(String(result.body)) as { dl: string; api: string };

    expect(result.ok).toBe(true);
    expect(result.headers?.['x-proxy-cache']).toBe('HIT');
    expect(json.dl).toContain('/repository/rust-proxy/rust-proxy/dl/');
    expect(json.dl).toContain('{crate}/{version}');
    expect(json.api).toContain('/repository/rust-proxy/rust-proxy/api/');
  });

  it('uses proxy download for standard crates.io downloads', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyDownload.mockResolvedValueOnce({
      ok: true,
      data: Buffer.from('crate-content'),
      contentType: 'application/gzip',
      skipCache: false,
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      '/api/v1/crates/demo/1.2.3/download',
    )) as {
      ok: boolean;
      headers?: Record<string, string>;
    };

    expect(result.ok).toBe(true);
    expect(result.headers?.['content-type']).toBe('application/gzip');
    expect(result.headers?.['x-proxy-cache']).toBe('MISS');
    expect(proxyDownload).toHaveBeenCalledWith(
      repo,
      'https://crates.example.test/api/v1/crates/demo/1.2.3/download',
      'demo',
      '1.2.3',
    );
  });

  it('proxies rust api magic paths through the decoded upstream base', async () => {
    const encodedBase = Buffer.from('https://crates.io/api/v1/').toString(
      'base64',
    );
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: { ok: true },
      headers: { 'content-type': 'application/json' },
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      `rust-proxy/api/${encodedBase}/crates/new`,
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ ok: true });
    expect(proxyHelperMock).toHaveBeenCalledWith(
      repo,
      'https://crates.io/api/v1/crates/new',
      undefined,
    );
  });

  it('returns a controlled error when direct crate downloads lack proxyUrl', async () => {
    storage.get.mockResolvedValueOnce(null);

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      {
        ...repo,
        config: {},
      } as Repository,
      '/api/v1/crates/demo/1.2.3/download',
    )) as {
      ok: boolean;
      message?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.message).toBe('No proxyUrl configured');
  });

  it('returns a controlled error when proxy helper is unavailable', async () => {
    proxyHelperModule.default = undefined;

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'config.json')) as {
      ok: boolean;
      message?: string;
    };

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Proxy helper missing');
    expect(warnSpy).toHaveBeenCalledWith(
      '[RustPlugin] Proxy helper unavailable: Error: proxy helper export is not callable',
    );
    warnSpy.mockRestore();
  });

  it('rewrites upstream config.json and caches the original payload', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        dl: 'https://static.crates.io/crates',
        api: 'https://crates.io',
      }),
      headers: {},
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(repo, 'config.json')) as {
      ok: boolean;
      body?: unknown;
    };

    const json = JSON.parse(String(result.body)) as { dl: string; api: string };

    expect(result.ok).toBe(true);
    expect(storage.save).toHaveBeenCalledWith(
      'rust/r1/proxy/config.json',
      Buffer.from(
        JSON.stringify({
          dl: 'https://static.crates.io/crates',
          api: 'https://crates.io',
        }),
      ),
    );
    expect(json.dl).toContain('/repository/rust-proxy/rust-proxy/dl/');
    expect(json.api).toContain('/repository/rust-proxy/rust-proxy/api/');
  });

  it('normalizes full local config.json urls before upstream fetch', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        dl: 'https://static.crates.io/crates',
        api: 'https://crates.io',
      }),
      headers: {},
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      repo,
      'https://registry.ravhub.test/repository/rust-proxy/config.json',
    )) as {
      ok: boolean;
    };

    expect(result.ok).toBe(true);
    expect(proxyHelperMock).toHaveBeenCalledWith(
      repo,
      'config.json',
      undefined,
    );
    expect(storage.save).toHaveBeenCalledWith(
      'rust/r1/proxy/config.json',
      Buffer.from(
        JSON.stringify({
          dl: 'https://static.crates.io/crates',
          api: 'https://crates.io',
        }),
      ),
    );
  });

  it('encodes repository names in rewritten config.json endpoints', async () => {
    storage.get.mockResolvedValueOnce(null);
    proxyHelperMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      body: JSON.stringify({
        dl: 'https://static.crates.io/crates',
        api: 'https://crates.io',
      }),
      headers: {},
    });

    const { proxyFetch } = initProxy(context);
    const result = (await proxyFetch(
      {
        ...repo,
        name: 'rust proxy#beta',
      } as Repository,
      'config.json',
    )) as {
      ok: boolean;
      body?: unknown;
    };

    expect(result.ok).toBe(true);
    const json = JSON.parse(String(result.body)) as { dl: string; api: string };

    expect(json.dl).toContain('/repository/rust%20proxy%23beta/rust-proxy/dl/');
    expect(json.api).toContain(
      '/repository/rust%20proxy%23beta/rust-proxy/api/',
    );
  });
});
