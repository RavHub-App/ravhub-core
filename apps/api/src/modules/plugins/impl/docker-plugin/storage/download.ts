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

import {
  fetchProxyBlob,
  findStoredBlob,
  isDigestReference,
  revalidateProxyTag,
} from './download-support';
import type { Repository } from '../utils/types';

// Plugin context references (will be set by init)
let storage: any = null;
let proxyFetch: any = null;
let getRepo: ((id: string) => Promise<Repository | null>) | null = null;
const pendingDownloads = new Map<string, Promise<any>>();

export function initDownload(context: {
  storage: any;
  proxyFetch?: any;
  getRepo?: any;
}) {
  storage = context.storage;
  proxyFetch = context.proxyFetch;
  getRepo = context.getRepo;
}

export async function download(repo: Repository, name: string, tag?: string) {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug('[DOWNLOAD->GETBLOB] Delegating', { name, tag });
  }
  return getBlob(repo, name, tag || 'latest');
}

export async function getBlob(repo: Repository, name: string, digest: string) {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug(
      `[GETBLOB] repo=${repo.name}, type=${repo.type}, name=${name}, digest=${digest}, config=${JSON.stringify(repo.config)}`,
    );

  if (repo.type === 'group') {
    return resolveGroupBlob(repo, name, digest);
  }

  const isProxyEarly = (repo?.type || '').toString().toLowerCase() === 'proxy';
  const isTagRef = !isDigestReference(digest);

  if (isProxyEarly && isTagRef) {
    try {
      const revalidated = await revalidateProxyTag(
        proxyFetch,
        repo,
        name,
        digest,
      );
      if (revalidated) {
        return revalidated;
      }
    } catch (e: any) {
      console.warn('[PROXY REVALIDATE TAG ERROR]', e.message);
    }
  }
  const storedBlob = await findStoredBlob(storage, repo, name, digest);
  if (storedBlob) {
    return storedBlob;
  }

  const isProxy = (repo?.type || '').toString().toLowerCase() === 'proxy';
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug('[GETBLOB PROXY CHECK]', {
      isProxy,
      repoType: repo?.type,
      repoName: repo?.name,
      digest,
    });
  if (isProxy) {
    try {
      return await fetchProxyBlob(
        proxyFetch,
        repo,
        name,
        digest,
        pendingDownloads,
      );
    } catch (err: any) {
      console.warn('[PROXY FETCH BLOB ERROR]', err.message);
      pendingDownloads.delete(`docker:${repo.id}:blob:${digest}`);
    }
  }
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug('[GETBLOB] Not found in any candidate or upstream');
  return { ok: false, message: 'not found' };
}

async function resolveGroupBlob(
  repo: Repository,
  name: string,
  digest: string,
) {
  const members = repo.config?.members || [];
  if (!getRepo) {
    return { ok: false, message: 'not found in group' };
  }

  for (const memberId of members) {
    try {
      const memberRepo = await getRepo(memberId);
      if (!memberRepo) {
        continue;
      }

      const result = await getBlob(memberRepo, name, digest);
      if (result.ok) {
        return result;
      }
    } catch {
      continue;
    }
  }

  return { ok: false, message: 'not found in group' };
}
