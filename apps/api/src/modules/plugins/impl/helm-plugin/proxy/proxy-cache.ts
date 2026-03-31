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
  buildTargetUrl,
  createMagicProxyCacheKey,
  createMissingBodyResponse,
  createStandardProxyCacheKey,
  decodeMagicProxyUrl,
  getResponseBody,
  HelmProxyResult,
  HelmRepository,
  isChartArchive,
  isChartRequest,
  isIndexRequest,
  toBuffer,
} from './proxy-helpers';
import {
  safelyRewriteIndex,
  saveProxyCache,
  tryReadMagicProxyCache,
  tryReadStandardProxyCache,
} from './proxy-cache-support';

export async function handleMagicProxyFetch(
  context: PluginContext,
  repo: HelmRepository,
  url: string,
  buildKey: Function,
) {
  const targetUrl = decodeMagicProxyUrl(url);
  const { keyId, urlForCache } = createMagicProxyCacheKey(
    buildKey,
    repo.id,
    targetUrl,
  );
  const cacheEnabled = repo.config?.cacheEnabled !== false;

  const cachedResult = await tryReadMagicProxyCache(
    context,
    repo,
    targetUrl,
    keyId,
    cacheEnabled,
  );
  if (cachedResult) {
    return cachedResult;
  }

  const response = (await proxyFetchWithAuth(
    repo,
    targetUrl,
  )) as HelmProxyResult;
  if (!response.ok) {
    return response;
  }

  const responseBody = getResponseBody(response);
  if (responseBody === undefined) {
    return createMissingBodyResponse();
  }

  const body = toBuffer(responseBody);
  if (body.length > 0 && cacheEnabled) {
    await saveProxyCache(context, repo, keyId, urlForCache, body, true);
  }

  return {
    ok: true,
    status: response.status,
    body,
    headers: response.headers,
  };
}

export async function handleStandardProxyFetch(
  context: PluginContext,
  repo: HelmRepository,
  url: string,
  buildKey: Function,
) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const isChart = isChartRequest(url);
  const isIndex = isIndexRequest(url);
  const targetUrl = buildTargetUrl(repo, url);

  const cachedResult = await tryReadStandardProxyCache(
    context,
    repo,
    url,
    targetUrl,
    buildKey,
    cacheEnabled,
    isChart,
    isIndex,
  );
  if (cachedResult) {
    return cachedResult;
  }

  const result = (await proxyFetchWithAuth(repo, targetUrl)) as HelmProxyResult;
  if (!result.ok) {
    return result;
  }

  const resultBody = getResponseBody(result);
  if (resultBody === undefined) {
    return createMissingBodyResponse();
  }

  const originalBuffer = toBuffer(resultBody);
  const finalBuffer = isIndex
    ? safelyRewriteIndex(originalBuffer)
    : originalBuffer;

  if ((isChart || isIndex) && cacheEnabled) {
    const { keyId, urlForCache } = createStandardProxyCacheKey(
      buildKey,
      repo.id,
      url,
    );
    await saveProxyCache(
      context,
      repo,
      keyId,
      urlForCache,
      originalBuffer,
      isChart,
    );
  }

  return {
    ...result,
    body: finalBuffer,
    headers: {
      ...(result.headers || {}),
      'content-type': isIndex
        ? 'text/yaml'
        : result.headers?.['content-type'] || 'application/octet-stream',
    },
  };
}
