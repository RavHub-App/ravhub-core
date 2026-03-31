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

import { runWithLock } from '../../../../../plugins-core/lock-helper';
import type { PluginContext, Repository } from '../utils/types';
import {
  getDockerCachedContentType,
  resolveDockerProxyRequest,
} from './cache-key';
import { getProxyModuleContext, initProxyModuleContext } from './context';
import { performDockerProxyFetch } from './fetch-runtime';
import { pingDockerUpstream } from './ping';

export function initProxyFetch(ctx: PluginContext) {
  initProxyModuleContext(ctx);
}

export async function proxyFetch(
  repo: Repository,
  urlStr: string,
  opts?: { skipCache?: boolean },
) {
  try {
    const { storage, context } = getProxyModuleContext();
    const request = resolveDockerProxyRequest(repo, urlStr);
    const cacheEnabled = repo.config?.cacheEnabled !== false;
    const skipCache = opts?.skipCache === true;
    const headers = {
      Accept:
        'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, */*',
    };

    if (!skipCache && cacheEnabled && request.key) {
      return runWithLock(context, `docker:proxy:${request.key}`, async () => {
        try {
          const cached = await storage.get(request.key!);
          if (cached) {
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
              console.debug('[PROXY FETCH CACHE HIT]', request.key);
            }
            return {
              ok: true,
              status: 200,
              body: cached,
              headers: {
                'content-type': getDockerCachedContentType(request.pathStr),
                'x-proxy-cache': 'HIT',
              },
              storageKey: request.key,
            };
          }
        } catch {}

        return performDockerProxyFetch(repo, urlStr, request, headers);
      });
    }

    return performDockerProxyFetch(repo, urlStr, request, headers);
  } catch (error) {
    return {
      ok: false,
      status: 500,
      message: String(error instanceof Error ? error.message : error),
    };
  }
}

export async function pingUpstream(repo: Repository, _context?: unknown) {
  return pingDockerUpstream(repo);
}
