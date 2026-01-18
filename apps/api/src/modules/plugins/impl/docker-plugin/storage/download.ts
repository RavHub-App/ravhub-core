/**
 * Download operations module for Docker plugin
 * Handles download and getBlob operations
 */

import { buildKey } from '../utils/key-utils';
import { normalizeImageName } from '../utils/helpers';
import type { Repository } from '../utils/types';

// Plugin context references (will be set by init)
let storage: any = null;
let proxyFetch: any = null;

/**
 * Initialize the download module with plugin context
 */
export function initDownload(context: { storage: any; proxyFetch?: any }) {
  storage = context.storage;
  proxyFetch = context.proxyFetch;
}

/**
 * Download a manifest by name and tag
 * For proxy repos, revalidates from upstream before returning cached version
 */
export async function download(repo: Repository, name: string, tag?: string) {
  const isProxy = (repo?.type || '').toString().toLowerCase() === 'proxy';
  // For proxy repos and tag-based manifest requests, try revalidating from
  // upstream on every request, then fall back to cached storage.
  try {
    if (isProxy && tag) {
      try {
        const targetEarly =
          repo?.config?.proxyUrl ||
          repo?.config?.docker?.proxyUrl ||
          repo?.config?.upstream ||
          repo?.config?.docker?.upstream ||
          repo?.config?.target ||
          repo?.config?.registry ||
          null;
        if (targetEarly) {
          const nameStr = Array.isArray(name) ? name.join('/') : name;
          const normalizedName = normalizeImageName(nameStr, targetEarly, repo);
          const encodedName = normalizedName
            .split('/')
            .map((s: string) => encodeURIComponent(s))
            .join('/');
          const upstreamUrl = `${String(targetEarly).replace(/\/$/, '')}/v2/${encodedName}/manifests/${encodeURIComponent(
            tag,
          )}`;
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
            console.debug('[PROXY REVALIDATE TAG]', {
              upstreamUrl,
              originalName: nameStr,
              normalizedName,
            });
          }
          const fetched = await proxyFetch?.(repo as any, upstreamUrl);
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
            console.debug('[PROXY REVALIDATE TAG RESULT]', {
              ok: fetched?.ok,
              status: fetched?.status,
              url: fetched?.url,
              storageKey: fetched?.storageKey,
              hasBody: !!fetched?.body,
            });
          }
          if (fetched?.ok && (fetched.url || fetched.body)) {
            return {
              ok: true,
              url: fetched.url,
              storageKey: fetched.storageKey,
              data: fetched.body,
            };
          }
          // If proxy fetch failed with a definitive error (not network issue), return the error
          if (fetched && !fetched.ok && fetched.status) {
            console.warn('[PROXY REVALIDATE TAG FAILED - download]', {
              status: fetched.status,
              message: fetched.message,
            });
            // Only try cache fallback for temporary errors (5xx), not for 4xx errors
            if (fetched.status >= 500) {
              if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                console.debug(
                  '[PROXY REVALIDATE TAG - download] Server error, trying cache fallback',
                );
            } else {
              // 4xx errors mean the resource doesn't exist or auth failed - don't try cache
              return {
                ok: false,
                message: fetched.message || 'upstream fetch failed',
                status: fetched.status,
              };
            }
          }
        }
      } catch (e: any) {
        console.warn('[PROXY REVALIDATE TAG ERROR - download]', e.message);
      }
    }

    // Fallback to cached storage (for hosted repos or when proxy upstream has temporary issues)
    const key = buildKey('docker', repo.id, name, 'manifests', tag || 'latest');
    // Verify the file actually exists before returning ok
    const exists = await storage.exists(key);
    if (!exists) {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug('[DOWNLOAD] Not found in cache:', key);
      return { ok: false, message: 'not found' };
    }
    const url = await storage.getUrl(key);
    return { ok: true, url };
  } catch (err) {
    return { ok: false };
  }
}

/**
 * Get a blob or manifest by digest
 * Searches multiple possible storage locations and falls back to upstream for proxy repos
 */
export async function getBlob(repo: Repository, name: string, digest: string) {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug(
      `[GETBLOB] repo=${repo.name}, type=${repo.type}, name=${name}, digest=${digest}`,
    );
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
        const fetchedEarly = await proxyFetch?.(repo as any, upstreamUrl);
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
      } catch (err: any) {
        console.warn('[PROXY FETCH BLOB ERROR]', err.message);
        // continue to return not found below
      }
    }
  }
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
    console.debug('[GETBLOB] Not found in any candidate or upstream');
  return { ok: false };
}
