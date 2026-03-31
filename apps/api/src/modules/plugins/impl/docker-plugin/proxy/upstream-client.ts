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

import type { Repository } from '../utils/types';
import {
  loadProxyFetchWithAuth,
  type DockerProxyFetchResponse,
} from './context';

export async function readDockerProxyBody(
  response: DockerProxyFetchResponse,
): Promise<Buffer> {
  const streamObject = response.stream;
  if (streamObject) {
    if (typeof (streamObject as { on?: unknown }).on === 'function') {
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        (
          streamObject as {
            on: (event: string, handler: (...args: unknown[]) => void) => void;
          }
        ).on('data', (chunk: unknown) => {
          chunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
          );
        });
        (
          streamObject as {
            on: (event: string, handler: (...args: unknown[]) => void) => void;
          }
        ).on('end', () => resolve());
        (
          streamObject as {
            on: (event: string, handler: (...args: unknown[]) => void) => void;
          }
        ).on('error', reject);
      });
      return Buffer.concat(chunks);
    }

    const readerFactory = (
      streamObject as {
        getReader?: () => {
          read: () => Promise<{ done: boolean; value?: Uint8Array }>;
        };
      }
    ).getReader;
    if (typeof readerFactory === 'function') {
      const reader = readerFactory.call(streamObject);
      const chunks: Buffer[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (value) {
          chunks.push(Buffer.from(value));
        }
      }
      return Buffer.concat(chunks);
    }

    throw new Error('unsupported stream type from upstream');
  }

  if (Buffer.isBuffer(response.body)) {
    return response.body;
  }

  if (typeof response.body === 'string') {
    return Buffer.from(response.body, 'utf8');
  }

  return Buffer.from(JSON.stringify(response.body ?? {}), 'utf8');
}

export async function fetchDockerUpstreamResponse(
  repo: Repository,
  urlStr: string,
  headers: Record<string, string>,
): Promise<DockerProxyFetchResponse> {
  const proxyFetchWithAuth = loadProxyFetchWithAuth();
  if (!proxyFetchWithAuth) {
    return {
      ok: false,
      status: 500,
      message: 'proxy-helper not found (plugins-core/proxy-helper)',
    };
  }

  const response = await proxyFetchWithAuth(repo, urlStr, {
    stream: true,
    headers,
  });
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug('[PROXY FETCH result]', {
      ok: response?.ok,
      status: response?.status,
      hasStream: !!response?.stream,
    });
  }

  if (response?.ok || response?.status !== 404) {
    return response;
  }

  try {
    const parsedUrl = new URL(urlStr);
    const decodedPath = decodeURIComponent(parsedUrl.pathname || '');
    const fallbackUrl = `${parsedUrl.origin}${decodedPath}${parsedUrl.search || ''}`;
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug(
        '[PROXY FETCH] first attempt 404, trying decoded path',
        fallbackUrl,
      );
    }

    const fallbackResponse = await proxyFetchWithAuth(repo, fallbackUrl, {
      stream: true,
      headers,
    });
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PROXY FETCH RESULT alt]', {
        ok: fallbackResponse?.ok,
        status: fallbackResponse?.status,
        hasStream: !!fallbackResponse?.stream,
      });
    }

    return fallbackResponse?.ok
      ? fallbackResponse
      : {
          ok: false,
          status: fallbackResponse?.status || response.status || 500,
          body: fallbackResponse?.body || response.body,
        };
  } catch {
    return { ok: false, status: response.status || 500, body: response.body };
  }
}
