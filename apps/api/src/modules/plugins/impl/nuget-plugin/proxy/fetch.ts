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
import { initMetadata } from './metadata';
import {
  cacheNugetProxyResponse,
  readCachedNugetProxyResponse,
} from './fetch-cache';
import {
  resolveNugetProxyRequest,
  rewriteServiceIndexIfNeeded,
} from './fetch-helpers';

type ProxyFetchResult = Awaited<ReturnType<typeof proxyFetchWithAuth>>;

export function initProxy(context: PluginContext) {
  const { processServiceIndex } = initMetadata(context);

  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      const request = resolveNugetProxyRequest(repo, url);
      const cachedResponse = await readCachedNugetProxyResponse({
        context,
        repo,
        cleanUrl: request.cleanUrl,
        isNupkg: request.isNupkg,
        isMetadata: request.isMetadata,
        targetUrl: request.targetUrl,
        processServiceIndex,
      });
      if (cachedResponse) {
        return cachedResponse;
      }

      const result: ProxyFetchResult = await proxyFetchWithAuth(
        repo,
        request.targetUrl,
        {
          stream: request.isNupkg,
        },
      );
      const buffer = await cacheNugetProxyResponse(
        context,
        repo,
        request.cleanUrl,
        request.isNupkg,
        request.isMetadata,
        result,
      );
      if (!buffer) {
        return result;
      }

      return {
        ...result,
        body: request.isMetadata
          ? rewriteServiceIndexIfNeeded(
              processServiceIndex,
              repo,
              request.cleanUrl,
              buffer,
            )
          : buffer,
        stream: undefined,
      };
    } catch (error: any) {
      return { ok: false, message: String(error) };
    }
  };

  return { proxyFetch };
}
