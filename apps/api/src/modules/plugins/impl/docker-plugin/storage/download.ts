/*
 * Copyright (C) 2026 RavHub Team
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
import { normalizeImageName } from '../utils/helpers';
import type { Repository } from '../utils/types';

// Plugin context references (will be set by init)
let storage: any = null;
let proxyFetch: any = null;
let getRepo: ((id: string) => Promise<Repository | null>) | null = null;
const pendingDownloads = new Map<string, Promise<any>>();

/**
 * Initialize the download module with plugin context
 */
export function initDownload(context: { storage: any; proxyFetch?: any; getRepo?: any }) {
  storage = context.storage;
  proxyFetch = context.proxyFetch;
  getRepo = context.getRepo;
}

/**
 * Download a manifest or blob.
 * Delegates to getBlob which handles both manifests (via tag) and blobs (via digest).
 */
export async function download(repo: Repository, name: string, tag?: string) {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug('[DOWNLOAD->GETBLOB] Delegating', { name, tag });
  }
  return getBlob(repo, name, tag || 'latest');
}

/**
 * Get a blob or manifest by digest/tag
 * Searches multiple possible storage locations and falls back to upstream for proxy repos
 */
export async function getBlob(repo: Repository, name: string, digest: string) {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug(
      `[GETBLOB] repo=${repo.name}, type=${repo.type}, name=${name}, digest=${digest}, config=${JSON.stringify(repo.config)}`,
    );

  // Group support: delegate to members
  if (repo.type === 'group') {
    const members = repo.config?.members || [];
    if (getRepo) {
      for (const memberId of members) {
        try {
          const memberRepo = await getRepo(memberId);
          if (memberRepo) {
            const res = await getBlob(memberRepo, name, digest);
            if (res.ok) return res;
          }
        } catch (e) {
          // ignore
        }
      }
    }
    return { ok: false, message: 'not found in group' };
  }

  // For proxy repos: if requesting a manifest by tag (not a sha* digest),
  // attempt to revalidate from upstream first. If upstream fails, fall back
  // to cached storage below.
  const isProxyEarly = (repo?.type || '').toString().toLowerCase() === 'proxy';
  const isTagRef =
    !digest.startsWith('sha256:') &&
    !digest.startsWith('sha384:') &&
    !digest.startsWith('sha512:');

  if (isProxyEarly && isTagRef) {
    try {
      const targetEarly =
        repo?.config?.proxyUrl ||
        repo?.config?.docker?.proxyUrl ||
        repo?.config?.upstream ||
        repo?.config?.docker?.upstream ||
        repo?.config?.target ||
        repo?.config?.registry ||
        null;

      console.debug('[GETBLOB DEBUG] Revalidate Start', { targetEarly });

      if (targetEarly) {
        const nameStr = Array.isArray(name) ? name.join('/') : name;
        // Normalize according to repo config // upstream
        const normalizedName = normalizeImageName(nameStr, targetEarly, repo);
        const encodedName = normalizedName
          .split('/')
          .map((s: string) => encodeURIComponent(s))
          .join('/');
        const upstreamUrl = `${String(targetEarly).replace(/\/$/, '')}/v2/${encodedName}/manifests/${encodeURIComponent(digest)}`;
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
          console.debug('[PROXY REVALIDATE TAG]', {
            upstreamUrl,
            originalName: nameStr,
            normalizedName,
          });

        // Use skipCache: true to force revalidation check
        const fetchedEarly = await proxyFetch?.(repo as any, upstreamUrl, { skipCache: true });
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
          console.debug('[PROXY REVALIDATE TAG RESULT (GETBLOB)]', {
            ok: fetchedEarly?.ok,
            status: fetchedEarly?.status
          });
        }
        if (
          fetchedEarly?.ok &&
          (fetchedEarly.url || fetchedEarly.storageKey || fetchedEarly.body)
        ) {
          // Upstream returned something (and was saved to storage by proxyFetch)
          return {
            ok: true,
            url: fetchedEarly.url,
            storageKey: fetchedEarly.storageKey,
            data: fetchedEarly.body,
          };
        }
      }
    } catch (e: any) {
      console.warn('[PROXY REVALIDATE TAG ERROR]', e.message);
      // ignore and fallback to cache below
    }
  }
  // For groups, iteration happens in PluginManagerService, so this only handles hosted/proxy
  const candidates = [
    buildKey('docker', repo.id, name, 'manifests', digest),
    buildKey('docker', repo.id, 'blobs', digest),
    buildKey('docker', repo.id, 'blobs', name, digest),
  ];
  for (const k of candidates) {
    try {
      // ensure the key actually exists before returning an URL — getUrl
      // for filesystem adapters returns a file:// path even when the file
      // doesn't exist, which would otherwise cause downstream 500 errors.
      const exists = await storage.exists(k);
      if (!exists) continue;
      const url = await storage.getUrl(k);
      if (url) return { ok: true, url, storageKey: k };
    } catch (err) {
      // continue to next candidate
    }
  }
  // If not found and this is a proxy repo, try to fetch from upstream
  const isProxy = (repo?.type || '').toString().toLowerCase() === 'proxy';
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug('[GETBLOB PROXY CHECK]', {
      isProxy,
      repoType: repo?.type,
      repoName: repo?.name,
      digest,
    });
  if (isProxy) {
    // Try multiple possible locations for the upstream URL
    const target =
      repo?.config?.proxyUrl ||
      repo?.config?.docker?.proxyUrl ||
      repo?.config?.upstream ||
      repo?.config?.docker?.upstream ||
      repo?.config?.target ||
      repo?.config?.registry ||
      null;

    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[GETBLOB DEBUG] Proxy Fallback', { target });
    }
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug('[GETBLOB PROXY TARGET]', {
        target,
        hasProxyUrl: !!repo?.config?.proxyUrl,
        hasDockerProxyUrl: !!repo?.config?.docker?.proxyUrl,
        hasUpstream: !!repo?.config?.upstream,
        hasDockerUpstream: !!repo?.config?.docker?.upstream,
      });
    if (target) {
      try {
        // Normalize name to string (can be array from express route params)
        const nameStr = Array.isArray(name) ? name.join('/') : name;
        const normalizedName = normalizeImageName(nameStr, target, repo);

        // Encode each path segment separately to preserve slashes in the name
        const encodedName = normalizedName
          .split('/')
          .map((s) => encodeURIComponent(s))
          .join('/');

        // Ensure we call the v2 API. If the target already contains /v2 in the path
        // don't duplicate it; otherwise prepend /v2/.
        const targetBase = target.replace(/\/$/, '');
        const needsV2 = !/\/v2(\/|$)/.test(targetBase);
        const v2Prefix = needsV2 ? '/v2' : '';
        // NOTE: digest strings include ':' (e.g. sha256:...). Do not percent-encode ':'
        // or some registries return 404 for blobs/manifests.
        const digestRef = encodeURIComponent(digest).replace(/%3A/gi, ':');

        // A manifest can also be addressed by digest, so try manifests first and
        // fall back to blobs for real layer/config blobs.
        const upstreamManifest = `${targetBase}${v2Prefix}/${encodedName}/manifests/${digestRef}`;
        const upstreamBlob = `${targetBase}${v2Prefix}/${encodedName}/blobs/${digestRef}`;

        // Coalescing for Blob/Manifest by Digest
        const blobCoalesceKey = `docker:${repo.id}:blob:${digest}`;
        if (pendingDownloads.has(blobCoalesceKey)) {
          return await pendingDownloads.get(blobCoalesceKey);
        }

        const fetchBlobTask = (async () => {
          try {
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
              console.debug('[PROXY FETCH BLOB]', {
                upstreamManifest,
                upstreamBlob,
                digest,
                nameStr,
                normalizedName,
                target,
              });
            let fetched = await proxyFetch?.(repo as any, upstreamManifest);
            if (
              !fetched?.ok &&
              (fetched?.status === 404 || fetched?.status === 400)
            ) {
              if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                console.debug(
                  '[PROXY FETCH BLOB] Manifest/Ref failed (status ' +
                  fetched.status +
                  '), trying blob endpoint',
                );
              fetched = await proxyFetch?.(repo as any, upstreamBlob);
            }
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
              console.debug('[PROXY FETCH BLOB RESULT]', {
                ok: fetched?.ok,
                status: fetched?.status,
                hasUrl: !!fetched?.url,
                hasBody: !!fetched?.body,
              });
            if (
              fetched?.ok &&
              (fetched.url || fetched.storageKey || fetched.body)
            ) {
              return {
                ok: true,
                url: fetched.url,
                storageKey: fetched.storageKey,
                data: fetched.body,
              };
            }
          } finally {
            pendingDownloads.delete(blobCoalesceKey);
          }
        })();

        pendingDownloads.set(blobCoalesceKey, fetchBlobTask);
        return await fetchBlobTask;

      } catch (err: any) {
        console.warn('[PROXY FETCH BLOB ERROR]', err.message);
        // continue to return not found below
        pendingDownloads.delete(`docker:${repo.id}:blob:${digest}`);
      }
    }
  }
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug('[GETBLOB] Not found in any candidate or upstream');
  return { ok: false };
}
