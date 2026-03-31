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
  getCanonicalCacheKey,
  getProxyCacheKey,
  rewriteServiceIndexIfNeeded,
} from './fetch-helpers';
import {
  cacheNugetPackageBuffer,
  resolveNugetProxyBodyBuffer,
  revalidateCachedNugetPackage,
} from './fetch-cache-support';

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

type CacheReadContext = {
  context: PluginContext;
  repo: Repository;
  cleanUrl: string;
  isNupkg: boolean;
  isMetadata: boolean;
  targetUrl: string;
  processServiceIndex: (repo: Repository, body: Buffer | string) => unknown;
};

export async function readCachedNugetProxyResponse({
  context,
  repo,
  cleanUrl,
  isNupkg,
  isMetadata,
  targetUrl,
  processServiceIndex,
}: CacheReadContext) {
  if (!isNupkg && !isMetadata) {
    return null;
  }

  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const canonicalKey = isNupkg ? getCanonicalCacheKey(repo, cleanUrl) : null;
  const cacheKey = getProxyCacheKey(repo, cleanUrl);

  try {
    let cached =
      cacheEnabled && canonicalKey
        ? await context.storage.get(canonicalKey)
        : null;
    if (!cached && cacheEnabled) {
      cached = await context.storage.get(cacheKey);
    }
    if (!cached) {
      return null;
    }

    if (isNupkg) {
      return await revalidateCachedPackage(repo, targetUrl, cached);
    }

    return {
      ok: true,
      status: 200,
      body: rewriteServiceIndexIfNeeded(
        processServiceIndex,
        repo,
        cleanUrl,
        cached,
      ),
      headers: {
        'content-type': 'application/json',
        'x-proxy-cache': 'HIT',
      },
    };
  } catch (error) {
    console.error(`[NUGET_PROXY] Cache check error for ${targetUrl}:`, error);
    return null;
  }
}

export async function cacheNugetProxyResponse(
  context: PluginContext,
  repo: Repository,
  cleanUrl: string,
  isNupkg: boolean,
  isMetadata: boolean,
  result: ProxyResult,
) {
  if (!(isNupkg || isMetadata) || !result.ok) {
    return null;
  }

  const buffer = await resolveProxyBodyBuffer(result);
  if (!buffer || buffer.length === 0) {
    return null;
  }

  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
  if (!(cacheEnabled && cacheMaxAgeDays > 0)) {
    return buffer;
  }

  if (isNupkg) {
    await saveNugetPackageCache(context, repo, cleanUrl, buffer);
    return buffer;
  }

  await context.storage.save(getProxyCacheKey(repo, cleanUrl), buffer);
  return buffer;
}

async function revalidateCachedPackage(
  repo: Repository,
  targetUrl: string,
  cached: Buffer,
) {
  return revalidateCachedNugetPackage(repo, targetUrl, cached);
}

async function resolveProxyBodyBuffer(result: ProxyResult) {
  return resolveNugetProxyBodyBuffer(result);
}

async function saveNugetPackageCache(
  context: PluginContext,
  repo: Repository,
  cleanUrl: string,
  buffer: Buffer,
) {
  await cacheNugetPackageBuffer(context, repo, cleanUrl, buffer);
}
