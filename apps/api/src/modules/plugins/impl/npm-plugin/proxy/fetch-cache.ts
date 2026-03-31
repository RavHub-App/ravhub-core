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

import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import {
  readCachedNpmMetadata,
  revalidateCachedNpmTarball,
  saveNpmProxyPayload,
} from './fetch-cache-support';

export type MetadataProcessor = (
  repo: Repository,
  data: Buffer | unknown,
) => unknown;

export type NpmProxyRequest = {
  upstreamRequestUrl: string;
  cleanPath: string;
  storagePath: string;
};

type ProxyResult = {
  ok?: boolean;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  message?: string;
};

export function resolveNpmProxyRequest(url: string): NpmProxyRequest {
  let upstreamRequestUrl = url.split('?')[0].split('#')[0];
  let cleanPath = upstreamRequestUrl;

  if (cleanPath.startsWith('http')) {
    try {
      const parsedUrl = new URL(cleanPath);
      let pathname = parsedUrl.pathname;
      if (pathname.startsWith('/repository/')) {
        const parts = pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
          pathname = parts.slice(2).join('/');
        }
      }
      cleanPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
      if (parsedUrl.pathname.startsWith('/repository/')) {
        upstreamRequestUrl = cleanPath;
      }
    } catch (error) {
      console.warn(
        '[NPM_PROXY] Failed to canonicalize request URL. Using raw path.',
        error,
      );
    }
  }

  return {
    upstreamRequestUrl,
    cleanPath,
    storagePath:
      !cleanPath.includes('/-/') && !cleanPath.endsWith('.tgz')
        ? `${cleanPath}/package.json`
        : cleanPath,
  };
}

export async function readCachedNpmProxyResponse(
  context: PluginContext,
  repo: Repository,
  request: NpmProxyRequest,
  processMetadata: MetadataProcessor,
) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  if (!cacheEnabled) {
    return null;
  }

  const proxyKey = getNpmProxyKey(repo, request.storagePath);
  try {
    const cachedData = await context.storage.get(proxyKey);
    if (!cachedData) {
      return null;
    }

    if (request.storagePath.endsWith('.tgz')) {
      return await revalidateCachedNpmTarball(
        repo,
        request.upstreamRequestUrl,
        cachedData,
      );
    }

    if (request.storagePath.endsWith('package.json')) {
      return await readCachedNpmMetadata(
        context,
        repo,
        proxyKey,
        cachedData,
        processMetadata,
      );
    }
  } catch (error) {
    console.warn(
      '[NPM_PROXY] Failed to read proxy cache entry. Falling back to upstream.',
      error,
    );
  }

  return null;
}

export async function buildNpmProxyUpstreamResponse(
  context: PluginContext,
  repo: Repository,
  request: NpmProxyRequest,
  result: ProxyResult,
  processMetadata: MetadataProcessor,
) {
  if (!(result.ok && result.body)) {
    return result;
  }

  await saveNpmProxyPayload(
    context,
    repo,
    request,
    result.body,
    getNpmProxyKey(repo, request.storagePath),
  );
  const isMetadata = Boolean(
    result.headers &&
    result.headers['content-type']?.includes('application/json'),
  );
  if (!isMetadata) {
    return result;
  }

  return {
    ...result,
    body: processMetadata(repo, result.body),
  };
}

function getNpmProxyKey(repo: Repository, storagePath: string) {
  return buildKey('npm', repo.id, 'proxy', storagePath);
}
