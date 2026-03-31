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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import proxyFetchWithAuth from '../../../../../plugins-core/proxy-helper';
import {
  createCacheHitResponse,
  createStandardProxyCacheKey,
  HelmRepository,
  isChartArchive,
  rewriteIndexYaml,
  tryIndexChartArtifact,
} from './proxy-helpers';

export async function tryReadMagicProxyCache(
  context: PluginContext,
  repo: HelmRepository,
  targetUrl: string,
  keyId: string,
  cacheEnabled: boolean,
) {
  if (!cacheEnabled) {
    return null;
  }

  try {
    const cached = await context.storage.get(keyId);
    if (!cached) {
      return null;
    }

    return await revalidateMagicProxyCache(repo, targetUrl, cached);
  } catch {
    return null;
  }
}

export async function tryReadStandardProxyCache(
  context: PluginContext,
  repo: HelmRepository,
  url: string,
  targetUrl: string,
  buildKey: Function,
  cacheEnabled: boolean,
  isChart: boolean,
  isIndex: boolean,
) {
  if ((!isChart && !isIndex) || !cacheEnabled) {
    return null;
  }

  const { keyId } = createStandardProxyCacheKey(buildKey, repo.id, url);
  try {
    const cached = await context.storage.get(keyId);
    if (!cached) {
      return null;
    }

    if (isChart) {
      return revalidateStandardChartCache(repo, targetUrl, cached);
    }

    return createCacheHitResponse(safelyRewriteIndex(cached), 'text/yaml');
  } catch {
    return null;
  }
}

export function safelyRewriteIndex(buffer: Buffer) {
  try {
    return rewriteIndexYaml(buffer);
  } catch {
    return buffer;
  }
}

export async function saveProxyCache(
  context: PluginContext,
  repo: HelmRepository,
  keyId: string,
  urlForCache: string,
  body: Buffer,
  shouldIndexChart: boolean,
) {
  try {
    await context.storage.save(keyId, body);
    if (shouldIndexChart && isChartArchive(urlForCache)) {
      await tryIndexChartArtifact(context, repo, keyId, urlForCache, body);
    }
  } catch (error) {
    console.error(`[HELM_PROXY] Cache failed for ${keyId}:`, error);
  }
}

async function revalidateMagicProxyCache(
  repo: HelmRepository,
  targetUrl: string,
  cached: Buffer,
) {
  try {
    const headResult = await proxyFetchWithAuth(repo, targetUrl, {
      method: 'HEAD',
      timeoutMs: 5000,
    });
    if (!headResult.ok) {
      console.warn(
        `[HELM_PROXY] Revalidation failed (status ${headResult.status}). Serving cache as fallback.`,
      );
      return createCacheHitResponse(cached, 'application/octet-stream');
    }

    const contentLength = headResult.headers?.['content-length'];
    const contentLengthChanged =
      contentLength !== undefined &&
      parseInt(contentLength, 10) !== cached.length;
    if (!contentLengthChanged) {
      return createCacheHitResponse(cached, 'application/octet-stream');
    }
  } catch {
    console.warn('[HELM_PROXY] Revalidation error. Serving cache as fallback.');
    return createCacheHitResponse(cached, 'application/octet-stream');
  }

  return null;
}

async function revalidateStandardChartCache(
  repo: HelmRepository,
  targetUrl: string,
  cached: Buffer,
) {
  try {
    const headResult = await proxyFetchWithAuth(repo, targetUrl, {
      method: 'HEAD',
      timeoutMs: 5000,
    });
    if (!headResult.ok) {
      return createCacheHitResponse(cached, 'application/octet-stream');
    }

    const contentLength = headResult.headers?.['content-length'];
    const contentLengthChanged =
      contentLength !== undefined &&
      parseInt(contentLength, 10) !== cached.length;
    if (!contentLengthChanged) {
      return createCacheHitResponse(cached, 'application/octet-stream');
    }
  } catch {
    return createCacheHitResponse(cached, 'application/octet-stream');
  }

  return null;
}
