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

import { Logger } from '@nestjs/common';
import {
  proxyFetchWithAuth,
  ProxyFetchResult,
} from '../../../src/plugins-core/proxy-helper';

describe('proxyFetchWithAuth', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('warns and retries bearer auth when draining the 401 body fails', async () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const challengeHeaders = new Headers({
      'www-authenticate':
        'Bearer realm="https://auth.example/token",service="registry.example",scope="repository:test/image:pull"',
      'content-type': 'application/json',
    });
    const tokenHeaders = new Headers({ 'content-type': 'application/json' });
    const successHeaders = new Headers({ 'content-type': 'application/json' });

    const challengeResponse = {
      status: 401,
      ok: false,
      url: 'https://registry.example/v2/test/image/manifests/latest',
      headers: challengeHeaders,
      arrayBuffer: jest.fn().mockRejectedValue(new Error('drain failed')),
    } as unknown as Response;

    const tokenResponse = {
      status: 200,
      ok: true,
      url: 'https://auth.example/token',
      headers: tokenHeaders,
      json: jest.fn().mockResolvedValue({ token: 'token-123' }),
    } as unknown as Response;

    const successResponse = {
      status: 200,
      ok: true,
      url: 'https://registry.example/v2/test/image/manifests/latest',
      headers: successHeaders,
      arrayBuffer: jest.fn().mockResolvedValue(Buffer.from('manifest-json')),
    } as unknown as Response;

    const fetchMock: jest.MockedFunction<typeof fetch> = jest
      .fn()
      .mockResolvedValueOnce(challengeResponse)
      .mockResolvedValueOnce(tokenResponse)
      .mockResolvedValueOnce(successResponse);

    global.fetch = fetchMock as typeof fetch;

    const result: ProxyFetchResult = await proxyFetchWithAuth(
      {
        config: {
          proxyUrl: 'https://registry.example',
          auth: {
            type: 'basic',
            username: 'demo',
            password: 'secret',
          },
        },
      },
      '/v2/test/image/manifests/latest',
      {
        headers: {
          Accept: 'application/vnd.docker.distribution.manifest.v2+json',
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to drain registry auth challenge body: Error: drain failed',
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://auth.example/token?service=registry.example&scope=repository%3Atest%2Fimage%3Apull',
      {
        headers: {
          Authorization: `Basic ${Buffer.from('demo:secret').toString('base64')}`,
        },
      },
    );
    const thirdCall = fetchMock.mock.calls[2];
    expect(thirdCall?.[0]).toBe(
      'https://registry.example/v2/test/image/manifests/latest',
    );
    const thirdInit = thirdCall?.[1] as RequestInit;
    const thirdHeaders = thirdInit.headers as Record<string, string>;
    expect(thirdHeaders.Authorization).toBe('Bearer token-123');
  });
});
