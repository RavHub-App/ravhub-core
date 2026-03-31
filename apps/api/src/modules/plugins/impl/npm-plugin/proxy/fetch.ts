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

import { PluginContext, Repository } from '../utils/types';
import { initMetadata } from './metadata';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import {
  buildNpmProxyUpstreamResponse,
  readCachedNpmProxyResponse,
  resolveNpmProxyRequest,
} from './fetch-cache';

export function initProxy(context: PluginContext) {
  const { storage } = context;
  const { processMetadata } = initMetadata(context);

  const proxyFetch = async (repo: Repository, url: string) => {
    const request = resolveNpmProxyRequest(url);

    const lockKey = `npm:proxy:${request.storagePath}`;
    return await runWithLock(context, lockKey, async () => {
      const cachedResponse = await readCachedNpmProxyResponse(
        context,
        repo,
        request,
        processMetadata,
      );
      if (cachedResponse) {
        return cachedResponse;
      }

      try {
        const result = await proxyFetchWithAuth(
          repo,
          request.upstreamRequestUrl,
        );
        return await buildNpmProxyUpstreamResponse(
          context,
          repo,
          request,
          result,
          processMetadata,
        );
      } catch (error) {
        return { ok: false, message: String(error) };
      }
    });
  };

  return { proxyFetch };
}
