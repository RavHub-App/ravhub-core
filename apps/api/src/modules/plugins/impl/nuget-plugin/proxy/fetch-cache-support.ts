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

import proxyFetchWithAuth from '../../../../../plugins-core/proxy-helper';
import type { PluginContext, Repository } from '../utils/types';
import {
  derivePackageIdentity,
  getCanonicalCacheKey,
  getProxyCacheKey,
} from './fetch-helpers';

type ProxyResult = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  stream?:
    | AsyncIterable<Uint8Array>
    | NodeJS.ReadableStream
    | { getReader: () => any }
    | null;
};

export async function revalidateCachedNugetPackage(
  repo: Repository,
  targetUrl: string,
  cached: Buffer,
) {
  try {
    const headResponse = await proxyFetchWithAuth(repo, targetUrl, {
      method: 'HEAD',
      timeoutMs: 5000,
    });
    if (headResponse.ok && headResponse.headers) {
      const contentLength = headResponse.headers['content-length'];
      if (!contentLength || parseInt(contentLength) === cached.length) {
        return buildPackageCacheHit(cached);
      }

      return null;
    }

    console.warn(
      `[NUGET_PROXY] Revalidation failed (status ${headResponse.status}). Serving cache as fallback.`,
    );
    return buildPackageCacheHit(cached);
  } catch (error) {
    console.warn(
      `[NUGET_PROXY] Revalidation error: ${error}. Serving cache as fallback.`,
    );
    return buildPackageCacheHit(cached);
  }
}

export async function resolveNugetProxyBodyBuffer(result: ProxyResult) {
  if (result.stream) {
    return await readNugetStreamBody(result.stream);
  }

  if (Buffer.isBuffer(result.body)) {
    return result.body;
  }
  if (typeof result.body === 'string') {
    return Buffer.from(result.body);
  }
  if (result.body !== undefined) {
    return Buffer.from(JSON.stringify(result.body));
  }

  return null;
}

export async function cacheNugetPackageBuffer(
  context: PluginContext,
  repo: Repository,
  cleanUrl: string,
  buffer: Buffer,
) {
  try {
    const identity = derivePackageIdentity(cleanUrl);
    if (!identity) {
      await context.storage.save(getProxyCacheKey(repo, cleanUrl), buffer);
      return;
    }

    const canonicalKey = getCanonicalCacheKey(repo, cleanUrl);
    if (!canonicalKey) {
      await context.storage.save(getProxyCacheKey(repo, cleanUrl), buffer);
      return;
    }

    await context.storage.save(canonicalKey, buffer);
    await indexNugetPackage(
      context,
      repo,
      canonicalKey,
      identity.name,
      identity.version,
      buffer.length,
    );
  } catch (error) {
    console.warn('[NUGET_PROXY] Error during cache key derivation:', error);
    await context.storage.save(getProxyCacheKey(repo, cleanUrl), buffer);
  }
}

function buildPackageCacheHit(cached: Buffer) {
  return {
    ok: true,
    status: 200,
    body: cached,
    headers: {
      'content-type': 'application/octet-stream',
      'x-proxy-cache': 'HIT',
    },
  };
}

async function readNugetStreamBody(
  stream:
    | AsyncIterable<Uint8Array>
    | NodeJS.ReadableStream
    | { getReader: () => any },
) {
  const chunks: Buffer[] = [];
  if (typeof (stream as { getReader?: () => any }).getReader === 'function') {
    const reader = (stream as { getReader: () => any }).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function indexNugetPackage(
  context: PluginContext,
  repo: Repository,
  storageKey: string,
  name: string,
  version: string,
  size: number,
) {
  if (!context.indexArtifact) {
    return;
  }

  try {
    await context.indexArtifact(repo, {
      ok: true,
      id: `${name}:${version}`,
      metadata: {
        name,
        version,
        storageKey,
        size,
      },
    });
  } catch (error) {
    console.warn('[NUGET_PROXY] indexArtifact failed:', error);
  }
}
