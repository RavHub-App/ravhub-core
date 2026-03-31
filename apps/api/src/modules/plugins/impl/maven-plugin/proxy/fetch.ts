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
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import {
  readCachedMavenResponse,
  cacheMavenProxyResponse,
} from './fetch-cache';
import {
  resolveMavenProxyRequest,
  resolveSnapshotArtifact,
} from './fetch-helpers';

export function initProxy(context: PluginContext) {
  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      const request = resolveMavenProxyRequest(url);
      const snapshotResult = await resolveSnapshotArtifact(
        repo,
        request.upstreamRequestUrl,
      );
      if (snapshotResult) {
        return snapshotResult;
      }

      const cachedResponse = await readCachedMavenResponse({
        context,
        repo,
        cleanUrl: request.cleanUrl,
        upstreamRequestUrl: request.upstreamRequestUrl,
        isXml: request.isXml,
        isArtifact: request.isArtifact,
        isMetadata: request.isMetadata,
      });
      if (cachedResponse) {
        return cachedResponse;
      }

      const result = await proxyFetchWithAuth(repo, request.upstreamRequestUrl);
      return await cacheMavenProxyResponse(
        context,
        repo,
        request.cleanUrl,
        result as any,
      );
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
