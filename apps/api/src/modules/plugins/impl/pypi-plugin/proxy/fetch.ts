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
import proxyFetchWithAuth from '../../../../../plugins-core/proxy-helper';
import { handleMagicProxyFetch } from './magic-proxy';
import {
  buildStandardPyPiProxyResponse,
  readStandardPyPiProxyCache,
  resolveStandardPyPiProxyRequest,
} from './standard-proxy';

export function initProxy(context: PluginContext) {
  const { processSimpleIndex } = initMetadata(context);
  const { storage } = context;

  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      const magicProxyResult = await handleMagicProxyFetch(context, repo, url);
      if (magicProxyResult) {
        return magicProxyResult;
      }

      const request = resolveStandardPyPiProxyRequest(url);
      const cachedResult = await readStandardPyPiProxyCache(
        context,
        repo,
        request,
        processSimpleIndex,
      );
      if (cachedResult) {
        return cachedResult;
      }

      const result = await proxyFetchWithAuth(repo, request.upstreamRequestUrl);
      return await buildStandardPyPiProxyResponse(
        context,
        repo,
        request,
        result,
        processSimpleIndex,
      );
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };

  return { proxyFetch };
}
