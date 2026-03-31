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
import { buildKey } from '../utils/key-utils';
import { parseMavenCoordsFromPath } from '../utils/maven';
import { PluginContext, Repository } from '../utils/types';
import { getContentTypeByPath } from './storage-helpers';
import { downloadHostedMavenArtifact } from './download-hosted-support';

export { downloadHostedMavenArtifact } from './download-hosted-support';

export type DownloadResult = {
  ok?: boolean;
  message?: string;
  data?: Buffer;
  body?: Buffer;
  headers?: Record<string, string>;
  contentType?: string;
};

type ProxyFetch = (repo: Repository, path: string) => Promise<DownloadResult>;

type RepoResolver = (id: string) => Promise<Repository | null>;

type StorageLike = PluginContext['storage'];

export function createMavenRepoResolver(context: PluginContext): RepoResolver {
  return async (id: string): Promise<Repository | null> => {
    if (!id || typeof context.getRepo !== 'function') {
      return null;
    }

    try {
      return ((await context.getRepo(id)) as Repository | null) ?? null;
    } catch (error) {
      console.warn(
        `[Maven] Failed to resolve group member ${id}: ${String(error)}`,
      );
      return null;
    }
  };
}

export async function downloadFromMavenGroup(
  repo: Repository,
  normalizedPath: string,
  visited: Set<string>,
  resolveRepo: RepoResolver,
  downloadImpl: (
    repo: Repository,
    path: string,
    visited: Set<string>,
  ) => Promise<DownloadResult>,
): Promise<DownloadResult> {
  const members: string[] = repo.config?.members ?? [];
  if (!Array.isArray(members) || members.length === 0) {
    return { ok: false, message: 'Not found' };
  }

  const repoKey = String(repo.id || repo.name || '');
  if (repoKey) {
    visited.add(repoKey);
  }

  for (const memberId of members) {
    const child = await resolveRepo(memberId);
    if (!child) {
      continue;
    }

    const childKey = String(child.id || child.name || '');
    if (childKey && visited.has(childKey)) {
      continue;
    }

    const result = await downloadImpl(child, normalizedPath, visited);
    if (result.ok) {
      return result;
    }
  }

  return { ok: false, message: 'Not found' };
}

export async function downloadFromMavenProxy(
  context: PluginContext,
  storage: StorageLike,
  repo: Repository,
  normalizedPath: string,
  proxyFetch: ProxyFetch,
): Promise<DownloadResult> {
  const proxyKey = buildKey('maven', repo.id, 'proxy', normalizedPath);

  try {
    const lockKey = `maven:${repo.id}:${normalizedPath}`;
    return await runWithLock(context, lockKey, async () => {
      const cached = await storage.get(proxyKey);
      if (cached) {
        return {
          ok: true,
          data: cached,
          contentType: getContentTypeByPath(normalizedPath),
        };
      }

      const proxied = await proxyFetch(repo, normalizedPath);
      if (!(proxied?.ok && proxied.body)) {
        return { ok: false, message: 'Not found in upstream' };
      }

      await cacheMavenProxyArtifact(
        context,
        repo,
        normalizedPath,
        proxyKey,
        proxied.body,
      );
      return {
        ok: true,
        data: proxied.body,
        contentType:
          proxied.headers?.['content-type'] ||
          getContentTypeByPath(normalizedPath),
      };
    });
  } catch (error) {
    console.warn(
      `[Maven] Proxy download failed for ${normalizedPath}: ${String(error)}`,
    );
    return { ok: false, message: 'Not found' };
  }
}

async function cacheMavenProxyArtifact(
  context: PluginContext,
  repo: Repository,
  normalizedPath: string,
  proxyKey: string,
  body: Buffer,
) {
  const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
  if (cacheMaxAgeDays <= 0) {
    return;
  }

  await context.storage.save(proxyKey, body);
  await tryIndexMavenProxyArtifact(
    context,
    repo,
    normalizedPath,
    proxyKey,
    body,
  );
}

async function tryIndexMavenProxyArtifact(
  context: PluginContext,
  repo: Repository,
  normalizedPath: string,
  proxyKey: string,
  body: Buffer,
) {
  if (
    !context.indexArtifact ||
    !(
      normalizedPath.endsWith('.jar') ||
      normalizedPath.endsWith('.pom') ||
      normalizedPath.endsWith('.aar')
    )
  ) {
    return;
  }

  try {
    const coords = parseMavenCoordsFromPath(normalizedPath);
    if (!coords) {
      return;
    }

    await context.indexArtifact(repo, {
      ok: true,
      id: normalizedPath,
      metadata: {
        name: coords.packageName,
        version: coords.version,
        path: normalizedPath,
        storageKey: proxyKey,
        size: body.length,
      },
    });
  } catch (error) {
    console.warn(
      `[Maven] Failed to index proxied artifact ${normalizedPath}: ${String(error)}`,
    );
  }
}
