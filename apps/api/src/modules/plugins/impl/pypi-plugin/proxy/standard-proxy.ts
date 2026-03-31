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
import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import { derivePyPiArtifactIdentity } from './magic-proxy';

type SimpleIndexProcessor = (
  repo: Repository,
  html: string,
  upstreamRequestUrl: string,
) => string;

type ProxyResult = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  message?: string;
};

type StandardProxyRequest = {
  upstreamRequestUrl: string;
  cleanUrl: string;
  isPackage: boolean;
  isMetadata: boolean;
};

export function resolveStandardPyPiProxyRequest(
  url: string,
): StandardProxyRequest {
  let upstreamRequestUrl = url.split('?')[0].split('#')[0];

  if (upstreamRequestUrl.startsWith('http')) {
    try {
      const parsedUrl = new URL(upstreamRequestUrl);
      if (parsedUrl.pathname.startsWith('/repository/')) {
        const parts = parsedUrl.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          upstreamRequestUrl = parts.slice(2).join('/');
          if (parsedUrl.pathname.endsWith('/')) {
            upstreamRequestUrl = `${upstreamRequestUrl}/`;
          }
        }
      }
    } catch {
      return buildStandardProxyRequest(upstreamRequestUrl);
    }
  }

  return buildStandardProxyRequest(upstreamRequestUrl);
}

export async function readStandardPyPiProxyCache(
  context: PluginContext,
  repo: Repository,
  request: StandardProxyRequest,
  processSimpleIndex: SimpleIndexProcessor,
) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  if (!(request.isPackage || request.isMetadata) || !cacheEnabled) {
    return null;
  }

  const keyId = buildPyPiProxyKey(repo, request);
  try {
    const cached = await context.storage.get(keyId);
    if (!cached) {
      return null;
    }

    return await revalidateStandardPyPiCache(
      repo,
      request,
      cached,
      processSimpleIndex,
    );
  } catch (error) {
    console.error(
      `[PyPI] Cache check error for ${request.upstreamRequestUrl}:`,
      error,
    );
    return null;
  }
}

export async function buildStandardPyPiProxyResponse(
  context: PluginContext,
  repo: Repository,
  request: StandardProxyRequest,
  result: ProxyResult,
  processSimpleIndex: SimpleIndexProcessor,
) {
  if (
    !(request.isPackage || request.isMetadata) ||
    !(result.ok && result.body)
  ) {
    return result;
  }

  const buffer = toBodyBuffer(result.body);
  if (buffer.length > 0) {
    await saveStandardPyPiProxyCache(context, repo, request, buffer);
  }

  return {
    ...result,
    body: request.isMetadata
      ? processSimpleIndex(repo, buffer.toString(), request.upstreamRequestUrl)
      : buffer,
  };
}

function buildStandardProxyRequest(
  upstreamRequestUrl: string,
): StandardProxyRequest {
  const cleanUrl = upstreamRequestUrl;
  const isPackage = /\.(whl|tar\.gz|zip|egg|bz2)$/i.test(cleanUrl);
  const isMetadata =
    !isPackage &&
    (upstreamRequestUrl.includes('/simple/') ||
      upstreamRequestUrl.endsWith('/'));

  return {
    upstreamRequestUrl,
    cleanUrl,
    isPackage,
    isMetadata,
  };
}

function buildPyPiProxyKey(repo: Repository, request: StandardProxyRequest) {
  return buildKey(
    'pypi',
    repo.id,
    'proxy',
    request.isPackage ? 'file' : 'metadata',
    request.cleanUrl,
  );
}

async function revalidateStandardPyPiCache(
  repo: Repository,
  request: StandardProxyRequest,
  cached: Buffer,
  processSimpleIndex: SimpleIndexProcessor,
) {
  try {
    const headResponse = await proxyFetchWithAuth(
      repo,
      request.upstreamRequestUrl,
      {
        method: 'HEAD',
        timeoutMs: 5000,
      },
    );

    if (headResponse.ok && headResponse.headers) {
      const contentLength = headResponse.headers['content-length'];
      if (
        request.isPackage &&
        contentLength &&
        parseInt(contentLength) !== cached.length
      ) {
        return null;
      }

      return createStandardCacheHit(request, repo, cached, processSimpleIndex);
    }

    console.warn(
      `[PyPI] Revalidation failed (status ${headResponse.status}). Serving cache as fallback.`,
    );
    return createStandardCacheHit(request, repo, cached, processSimpleIndex);
  } catch (error) {
    console.warn(
      `[PyPI] Revalidation error: ${error}. Serving cache as fallback.`,
    );
    return createStandardCacheHit(request, repo, cached, processSimpleIndex);
  }
}

function createStandardCacheHit(
  request: StandardProxyRequest,
  repo: Repository,
  cached: Buffer,
  processSimpleIndex: SimpleIndexProcessor,
) {
  return {
    ok: true,
    status: 200,
    body: request.isMetadata
      ? processSimpleIndex(repo, cached.toString(), request.upstreamRequestUrl)
      : cached,
    headers: {
      'content-type': request.isMetadata
        ? 'text/html'
        : 'application/octet-stream',
      'x-proxy-cache': 'HIT',
    },
  };
}

async function saveStandardPyPiProxyCache(
  context: PluginContext,
  repo: Repository,
  request: StandardProxyRequest,
  buffer: Buffer,
) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
  if (!(cacheEnabled && cacheMaxAgeDays > 0)) {
    return;
  }

  const keyId = buildPyPiProxyKey(repo, request);
  try {
    await context.storage.save(keyId, buffer);
    await tryIndexPyPiArtifact(context, repo, request, keyId, buffer);
  } catch (error) {
    console.error(`[PyPI] Failed to cache ${keyId}:`, error);
  }
}

async function tryIndexPyPiArtifact(
  context: PluginContext,
  repo: Repository,
  request: StandardProxyRequest,
  keyId: string,
  buffer: Buffer,
) {
  if (!(request.isPackage && context.indexArtifact)) {
    return;
  }

  const filename = request.cleanUrl.split('/').pop() || 'unknown';
  const { packageName, version } = derivePyPiArtifactIdentity(filename);
  await context.indexArtifact(repo, {
    ok: true,
    id: `${packageName}:${version}`,
    metadata: {
      name: packageName,
      version,
      filename,
      storageKey: keyId,
      size: buffer.length,
    },
  });
}

function toBodyBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  return Buffer.from(JSON.stringify(body));
}
