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
import { parseMavenCoordsFromPath } from '../utils/maven';
import type { PluginContext, Repository } from '../utils/types';
import {
  isMavenIndexingExcluded,
  revalidateCachedMavenArtifact,
  shouldRefreshMavenMetadata,
  toMavenProxyBuffer,
} from './fetch-cache-support';

export type ProxyResponse = {
  ok?: boolean;
  status?: number;
  body?: Buffer | string | object;
  headers?: Record<string, string>;
  message?: string;
  metadata?: {
    name: string;
    version: string;
    path: string;
  };
};

type CacheReadContext = {
  context: PluginContext;
  repo: Repository;
  cleanUrl: string;
  upstreamRequestUrl: string;
  isXml: boolean;
  isArtifact: boolean;
  isMetadata: boolean;
};

export async function readCachedMavenResponse({
  context,
  repo,
  cleanUrl,
  upstreamRequestUrl,
  isXml,
  isArtifact,
}: CacheReadContext) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  if (!(context.storage && cacheEnabled)) {
    return null;
  }

  const key = buildKey('maven', repo.id, 'proxy', cleanUrl);
  const cached = await context.storage.get(key);
  if (!cached) {
    return null;
  }

  if (isArtifact) {
    return await revalidateCachedMavenArtifact(
      repo,
      upstreamRequestUrl,
      cached,
    );
  }

  if (await shouldRefreshMavenMetadata(context, repo, cleanUrl, key)) {
    return null;
  }

  return {
    ok: true,
    body: cached,
    headers: {
      'content-type': isXml ? 'application/xml' : 'application/octet-stream',
      'content-length': cached.length.toString(),
      'x-proxy-cache': 'HIT',
    },
  };
}

export async function cacheMavenProxyResponse(
  context: PluginContext,
  repo: Repository,
  cleanUrl: string,
  result: ProxyResponse,
) {
  if (!result.ok) {
    return result;
  }

  const key = buildKey('maven', repo.id, 'proxy', cleanUrl);
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const content = toMavenProxyBuffer(result.body);
  if (content && context.storage && cacheEnabled) {
    try {
      await context.storage.save(key, content);
    } catch (error) {
      console.error('[MavenPlugin] Failed to cache proxy artifact:', error);
    }
  }

  const coords = parseMavenCoordsFromPath(cleanUrl);
  if (coords && !isMavenIndexingExcluded(cleanUrl)) {
    result.metadata = {
      name: coords.packageName,
      version: coords.version,
      path: cleanUrl,
    };
  }

  return result;
}
