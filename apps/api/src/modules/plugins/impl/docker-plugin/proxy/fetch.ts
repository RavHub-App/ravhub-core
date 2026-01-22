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
import type { Repository, PluginContext } from '../utils/types';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

// Plugin context references (will be set by init)
let storage: any = null;
let indexArtifact: any = null;
let context: PluginContext | null = null;

function loadProxyFetchWithAuth():
  | ((repo: Repository, url: string, opts?: any) => Promise<any>)
  | null {
  try {
    return require('../../../../../plugins-core/proxy-helper').default;
  } catch {
    return null;
  }
}

/**
 * Initialize the proxy fetch module with plugin context
 */
export function initProxyFetch(ctx: PluginContext) {
  storage = ctx.storage;
  indexArtifact = (ctx as any).indexArtifact;
  context = ctx;
}

/**
 * Fetch content from upstream registry with authentication and caching
 */
export async function proxyFetch(repo: Repository, urlStr: string, opts?: any) {
  try {
    const proxyFetchWithAuth = loadProxyFetchWithAuth();
    if (!proxyFetchWithAuth) {
      return {
        ok: false,
        status: 500,
        message: 'proxy-helper not found (plugins-core/proxy-helper)',
      };
    }

    // choose storage key based on path (digest // manifests // fallback)
    const pathStr = new URL(urlStr).pathname || '';
    let key = null as string | null;
    // try to extract image name between /v2/ and /{manifests|blobs}/
    const nameMatch = pathStr.match(/\/v2\/(.+?)\/(?:manifests|blobs)\//);
    const imgName = nameMatch ? decodeURIComponent(nameMatch[1]) : null;
    const blobMatch = pathStr.match(/blobs\/(sha256:[A-Fa-f0-9:\-]+)/i);
    if (blobMatch) {
      // Save under global digest path; getBlob searches this.
      key = buildKey('docker', repo.id, 'blobs', blobMatch[1]);
    }
    const maniMatch = pathStr.match(/manifests\/(.+)$/);
    if (!key && maniMatch) {
      // Save manifests under name-aware path so download()/getBlob() can locate them
      if (imgName) {
        key = buildKey('docker', repo.id, 'manifests', imgName, maniMatch[1]);
      } else {
        key = buildKey('docker', repo.id, 'manifests', maniMatch[1]);
      }
    }

    const cacheEnabled = repo.config?.cacheEnabled !== false;
    const skipCache = opts?.skipCache || false;

    const headers: any = {
      Accept:
        'application/vnd.docker.distribution.manifest.v2+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json, */*',
    };

    if (!skipCache && cacheEnabled && key) {
      const lockKey = `docker:proxy:${key}`;
      return await runWithLock(context!, lockKey, async () => {
        try {
          const cached = await storage.get(key);
          if (cached) {
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
              console.debug('[PROXY FETCH CACHE HIT]', key);
            return {
              ok: true,
              status: 200,
              body: cached,
              headers: {
                'content-type': pathStr.includes('/manifests/')
                  ? 'application/vnd.docker.distribution.manifest.v2+json'
                  : 'application/octet-stream',
                'x-proxy-cache': 'HIT',
              },
              storageKey: key,
            };
          }
        } catch (e) {
          /* ignore */
        }

        return await performProxyFetch(repo, urlStr, key, headers, pathStr, imgName, maniMatch);
      });
    }

    return await performProxyFetch(repo, urlStr, key, headers, pathStr, imgName, maniMatch);
  } catch (err: any) {
    return { ok: false, status: 500, message: String(err?.message ?? err) };
  }
}

/**
 * Internal helper to perform the actual fetch and save to storage
 */
async function performProxyFetch(
  repo: Repository,
  urlStr: string,
  key: string | null,
  headers: any,
  pathStr: string,
  imgName: string | null,
  maniMatch: RegExpMatchArray | null,
) {
  const proxyFetchWithAuth = loadProxyFetchWithAuth();
  if (!proxyFetchWithAuth) {
    return {
      ok: false,
      status: 500,
      message: 'proxy-helper not found (plugins-core/proxy-helper)',
    };
  }

  const cacheEnabled = repo.config?.cacheEnabled !== false;

  try {
    let res = await proxyFetchWithAuth(repo, urlStr, { stream: true, headers });
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PROXY FETCH result]', {
        ok: res?.ok,
        status: res?.status,
        hasStream: !!res?.stream,
      });
    }

    // If first attempt returned 404 (common when URL has encoded components)
    // try a decoded-path fallback — some upstreams expect raw ':' characters
    // in the path (e.g., digest `sha256:...`) while some callers encode them.
    if (!res || !res.ok) {
      if (res && res.status === 404) {
        try {
          const u = new URL(urlStr);
          const decodedPath = decodeURIComponent(u.pathname || '');
          const altUrl = `${u.origin}${decodedPath}${u.search || ''}`;
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug(
              '[PROXY FETCH] first attempt 404, trying decoded path',
              altUrl,
            );
          const res2 = await proxyFetchWithAuth(repo, altUrl, {
            stream: true,
            headers,
          });
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH RESULT alt]', {
              ok: res2?.ok,
              status: res2?.status,
              hasStream: !!res2?.stream,
            });
          if (res2 && res2.ok) {
            // use res2 in place of res
            res = res2;
          } else {
            return {
              ok: false,
              status: res2?.status || res.status || 500,
              body: res2?.body || res?.body,
            };
          }
        } catch {
          return { ok: false, status: res?.status || 500, body: res?.body };
        }
      } else {
        return { ok: false, status: res?.status || 500, body: res?.body };
      }
    }

    // Variable to store the buffer for later use in artifact indexing
    let savedBuffer: Buffer | null = null;

    try {
      // if underlying response provides a stream, prefer saving via stream-to-buffer
      if (res.stream) {
        // Support both Node.js streams (have .on) and WHATWG ReadableStream
        const streamObj: any = res.stream;
        let buf: Buffer;
        if (typeof streamObj.on === 'function') {
          // Node.js Readable
          const bufs: any[] = [];
          await new Promise((resolve, reject) => {
            streamObj.on('data', (d: any) => bufs.push(d));
            streamObj.on('end', () => resolve(true));
            streamObj.on('error', reject);
          });
          buf = Buffer.concat(bufs);
        } else if (typeof streamObj.getReader === 'function') {
          // Web WHATWG ReadableStream
          const reader = streamObj.getReader();
          const bufs: any[] = [];
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) bufs.push(Buffer.from(value));
          }
          buf = Buffer.concat(bufs);
        } else {
          return {
            ok: false,
            status: 500,
            message: 'unsupported stream type from upstream',
          };
        }
        savedBuffer = buf; // Capture buffer for later use
        const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
        if (cacheEnabled && cacheMaxAgeDays > 0) {
          await storage.save(key, buf);
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH SAVED]', {
              storageKey: key,
              status: res.status,
              bufferSize: buf.length,
            });
        }
      } else if (Buffer.isBuffer(res.body)) {
        savedBuffer = res.body; // Capture buffer for later use
        const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
        if (cacheEnabled && cacheMaxAgeDays > 0) {
          await storage.save(key, res.body);
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH SAVED]', {
              storageKey: key,
              status: res.status,
              bufferSize: res.body.length,
            });
        }
      } else if (typeof res.body === 'string') {
        savedBuffer = Buffer.from(res.body, 'utf8'); // Convert string to buffer
        const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
        if (cacheEnabled && cacheMaxAgeDays > 0) {
          await storage.save(key, res.body);
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH SAVED]', {
              storageKey: key,
              status: res.status,
              stringLength: res.body.length,
            });
        }
      } else {
        // save JSON-ish result
        const jsonStr = JSON.stringify(res.body ?? {});
        savedBuffer = Buffer.from(jsonStr, 'utf8');
        const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
        if (cacheEnabled && cacheMaxAgeDays > 0) {
          await storage.save(key, jsonStr);
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH_SAVED]', {
              storageKey: key,
              status: res.status,
            });
        }
      }
    } catch (err: any) {
      return {
        ok: false,
        status: res.status || 500,
        message: 'failed to save to storage: ' + String(err),
      };
    }

    // Index artifact if this is a manifest fetch for a proxy repo
    const isManifest = maniMatch && imgName;
    if (isManifest && indexArtifact) {
      try {
        const tag = maniMatch[1];
        // Skip digest-based manifests (internal storage)
        if (
          !tag.startsWith('sha256:') &&
          !tag.startsWith('sha384:') &&
          !tag.startsWith('sha512:')
        ) {
          let size = 0;

          // Use the savedBuffer we captured during save
          if (savedBuffer) {
            size = savedBuffer.length;

            // Try to parse manifest to get layer sizes
            try {
              const manifest = JSON.parse(savedBuffer.toString('utf8'));
              if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                console.debug('[PROXY FETCH] Parsed manifest:', {
                  hasLayers: !!manifest?.layers,
                  layersCount: Array.isArray(manifest?.layers)
                    ? manifest.layers.length
                    : 0,
                  hasManifests: !!manifest?.manifests,
                  manifestsCount: Array.isArray(manifest?.manifests)
                    ? manifest.manifests.length
                    : 0,
                  hasConfig: !!manifest?.config,
                  configSize: manifest?.config?.size,
                  mediaType: manifest?.mediaType,
                  manifestKeys: Object.keys(manifest || {}),
                });

              // Check if this is a manifest list (multi-platform image)
              if (Array.isArray(manifest?.manifests)) {
                // This is a manifest list - sum sizes of all platform manifests
                const manifestsSize = manifest.manifests.reduce(
                  (acc: number, m: any) => acc + (m.size || 0),
                  0,
                );
                if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                  console.debug(
                    '[PROXY FETCH] Manifest list total size:',
                    manifestsSize,
                    'manifests:',
                    manifest.manifests.map((m: any) => ({
                      platform: m.platform?.architecture,
                      size: m.size,
                    })),
                  );
                size += manifestsSize;
              } else if (Array.isArray(manifest?.layers)) {
                // This is a regular manifest - sum layer sizes
                const layersSize = manifest.layers.reduce(
                  (acc: number, l: any) => acc + (l.size || 0),
                  0,
                );
                if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                  console.debug(
                    '[PROXY FETCH] Layers total size:',
                    layersSize,
                    'layers:',
                    manifest.layers.map((l: any) => ({
                      digest: l.digest?.substring(0, 20),
                      size: l.size,
                    })),
                  );
                size += layersSize;
              }

              if (manifest?.config?.size) {
                if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
                  console.debug(
                    '[PROXY FETCH] Config size:',
                    manifest.config.size,
                  );
                size += manifest.config.size;
              }
            } catch (e) {
              console.warn(
                '[PROXY FETCH] Failed to parse manifest for size calculation:',
                e,
              );
            }
          } else {
            if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
              console.debug(
                '[PROXY FETCH] No buffer available for size calculation, size will be 0',
              );
          }

          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH] Indexing artifact:', {
              name: imgName,
              tag,
              size,
              hasBuffer: !!savedBuffer,
            });

          await indexArtifact(repo, {
            ok: true,
            id: `${imgName}:${tag}`,
            metadata: {
              name: imgName,
              version: tag,
              storageKey: key,
              size: size,
              type: 'docker/manifest',
            },
          });
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug('[PROXY FETCH] Artifact indexed successfully');
        }
      } catch (err: any) {
        console.warn('[PROXY FETCH] Failed to index artifact:', err.message);
      }
    }

    try {
      const url = await storage.getUrl(key);
      return {
        ok: true,
        url,
        storageKey: key,
        status: res.status,
        body: savedBuffer,
      };
    } catch (err: any) {
      return {
        ok: true,
        url: urlStr,
        storageKey: key,
        status: res.status,
        body: savedBuffer,
      };
    }
  } catch (err: any) {
    return { ok: false, status: 500, message: String(err?.message ?? err) };
  }
}

/**
 * Ping the upstream/proxy target for a repository to test reachability.
 * Returns basic reachability information and HTTP status when available.
 */
export async function pingUpstream(repo: any, _context?: any) {
  try {
    const target =
      repo?.config?.docker?.proxyUrl ||
      repo?.config?.upstream ||
      repo?.config?.docker?.upstream ||
      repo?.config?.target ||
      repo?.config?.registry ||
      null;

    if (!target) return { ok: false, message: 'no upstream configured' };

    // prefer the standard registry ping endpoint
    const base = String(target).replace(/\/$/, '');
    const pingUrl = `${base}/v2/`;

    const proxyFetchWithAuth = loadProxyFetchWithAuth();
    if (!proxyFetchWithAuth) {
      return {
        ok: false,
        message: 'proxy-helper not found (plugins-core/proxy-helper)',
      };
    }

    let res: any;
    try {
      res = await proxyFetchWithAuth(repo, pingUrl, {
        stream: false,
        timeoutMs: 5000,
        maxRetries: 1,
      });
    } catch (err: any) {
      return { ok: false, message: String(err?.message ?? err) };
    }

    // Any HTTP response code < 500 means upstream is reachable (401/403 means protected but up)
    if (res && typeof res.status === 'number') {
      return {
        ok: res.ok || res.status < 500,
        status: res.status,
        reachable: res.status < 500,
        url: pingUrl,
        message: res.ok
          ? undefined
          : res.body?.message || 'Upstream returned error status',
      };
    }

    return { ok: false, message: 'no response from upstream' };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}
