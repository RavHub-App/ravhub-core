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

import { PluginContext, Repository } from '../utils/types';
import { initMetadata } from './metadata';
import proxyFetchWithAuth from '../../../../../plugins-core/proxy-helper';
import { buildKey } from '../utils/key-utils';

export function initProxy(context: PluginContext) {
  const { processServiceIndex } = initMetadata(context);
  const { storage } = context;

  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      let targetUrl = url;

      // Handle V3 Proxy Magic
      // URL format: v3-proxy/<encoded-upstream-base>/<rest-of-path>
      if (url.startsWith('v3-proxy/')) {
        // If the URL is already decoded by the framework, we might see "v3-proxy/https://..."
        // In that case, we need to be careful about splitting.

        // Check if we have "v3-proxy/http" pattern which suggests decoded URL
        if (url.match(/^v3-proxy\/https?:\/\//)) {
          // It's decoded.
          // Format: v3-proxy/<upstream-base>/<rest>
          // But wait, if it's decoded, how do we know where base ends?
          // The upstream base usually ends with a slash or we can assume it's the first part?
          // Actually, the "magic" relies on the client sending encoded base.
          // If the framework decodes it, we are in trouble unless we can re-construct it.

          // However, looking at the logs: "v3-proxy/https://api.nuget.org/v3-flatcontainer/newtonsoft.json/..."
          // It seems the double slash might be the separator if the original was encoded with trailing slash?
          // Or maybe we can just take everything after v3-proxy/ as the target URL?
          // The original intent was: v3-proxy/<base>/<path> -> <base>/<path>
          // If <base> is "https://api.nuget.org/v3-flatcontainer/" and <path> is "newtonsoft.json/..."
          // Then target is "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/..."
          // So, effectively, we just want to strip "v3-proxy/" prefix!

          targetUrl = url.replace(/^v3-proxy\//, '');

          // Fix potential double slashes introduced by decoding + concatenation (e.g. .../v3-flatcontainer/package...)
          // But preserve protocol ://
          const [proto, rest] = targetUrl.split('://');
          if (rest) {
            // Replace double slashes with single slash in the path part
            targetUrl = `${proto}://${rest.replace(/\/\//g, '/')}`;
          }
        } else {
          const pathParts = url.split('/');
          // pathParts[0] is 'v3-proxy'
          const encodedBase = pathParts[1];
          const rest = pathParts.slice(2).join('/');

          if (encodedBase) {
            const upstreamBase = decodeURIComponent(encodedBase);
            // Construct new target URL
            // upstreamBase usually ends with // or not.
            // rest is the path appended by client.

            // Ensure we handle slashes correctly
            targetUrl = upstreamBase.endsWith('/')
              ? `${upstreamBase}${rest}`
              : `${upstreamBase}/${rest}`;
          }
        }
      } else {
        // Default fetch (likely for index.json or V2)
        const proxyUrl = repo.config?.proxyUrl || '';

        // If URL is absolute, use it directly
        if (url.match(/^https?:\/\//)) {
          targetUrl = url;
        } else if (url === 'index.json' && proxyUrl.endsWith('index.json')) {
          // Special handling for NuGet V3 index.json to avoid double appending
          targetUrl = proxyUrl;
        } else {
          // If proxyUrl ends with .json (like index.json), use its directory for relative paths
          let currentBase = proxyUrl;

          const cleanUrlForCheck = url.split('?')[0].split('#')[0];
          const isNupkgEarly = cleanUrlForCheck
            .toLowerCase()
            .endsWith('.nupkg');

          // Quality of Life: If requesting .nupkg directly and proxying nuget.org index.json,
          // use the flatcontainer URL which is standard for nuget.org.
          if (
            isNupkgEarly &&
            proxyUrl.includes('api.nuget.org/v3/index.json')
          ) {
            currentBase = 'https://api.nuget.org/v3-flatcontainer/';
          } else if (currentBase.endsWith('.json')) {
            currentBase = currentBase.substring(
              0,
              currentBase.lastIndexOf('/'),
            );
          }

          targetUrl = `${currentBase.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
        }
      }

      // Check for package download (.nupkg)
      const cleanUrl = targetUrl.split('?')[0].split('#')[0];
      const isNupkg = cleanUrl.toLowerCase().endsWith('.nupkg');
      const isMetadata = cleanUrl.toLowerCase().endsWith('.json');

      if (isNupkg || isMetadata) {
        // Try to derive canonical key first
        let canonicalKey: string | null = null;
        if (isNupkg) {
          try {
            const parts = cleanUrl.split('/').filter(Boolean);
            if (parts.length >= 3) {
              const name = parts[parts.length - 3];
              const version = parts[parts.length - 2];
              const filename = parts[parts.length - 1] || '';
              if (filename.startsWith(name) && filename.includes(version)) {
                canonicalKey = buildKey(
                  'nuget',
                  repo.id,
                  'proxy',
                  name,
                  version,
                  filename,
                );
              }
            }
            if (!canonicalKey) {
              const filename = cleanUrl.split('/').pop() || '';
              const m = filename.match(/^(.+)\.(.+)\.nupkg$/i);
              if (m) {
                canonicalKey = buildKey(
                  'nuget',
                  repo.id,
                  'proxy',
                  m[1],
                  m[2],
                  filename,
                );
              }
            }
          } catch (e) {}
        }

        const keyId = buildKey('nuget', repo.id, 'proxy', cleanUrl);
        const cacheEnabled = repo.config?.cacheEnabled !== false;

        try {
          let cached =
            cacheEnabled && canonicalKey
              ? await storage.get(canonicalKey)
              : null;
          if (!cached && cacheEnabled) cached = await storage.get(keyId);

          if (cached) {
            if (isNupkg) {
              // Revalidate .nupkg with HEAD request
              try {
                const headRes = await proxyFetchWithAuth(repo, targetUrl, {
                  method: 'HEAD',
                  timeoutMs: 5000,
                });
                if (headRes.ok && headRes.headers) {
                  const contentLength = headRes.headers['content-length'];
                  if (
                    contentLength &&
                    parseInt(contentLength) !== cached.length
                  ) {
                    // Fall through to fetch from upstream
                  } else {
                    return {
                      ok: true,
                      status: 200,
                      body: cached,
                      headers: {
                        'content-type': 'application/octet-stream',
                        'x-proxy-cache': 'HIT',
                      },
                    };
                  }
                } else {
                  console.warn(
                    `[NUGET_PROXY] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
                  );
                  return {
                    ok: true,
                    status: 200,
                    body: cached,
                    headers: {
                      'content-type': 'application/octet-stream',
                      'x-proxy-cache': 'HIT',
                    },
                  };
                }
              } catch (revalErr) {
                console.warn(
                  `[NUGET_PROXY] Revalidation error: ${revalErr}. Serving cache as fallback.`,
                );
                return {
                  ok: true,
                  status: 200,
                  body: cached,
                  headers: {
                    'content-type': 'application/octet-stream',
                    'x-proxy-cache': 'HIT',
                  },
                };
              }
            } else {
              let body = cached;
              if (isMetadata && cleanUrl.endsWith('index.json')) {
                body = processServiceIndex(repo, cached);
              }
              return {
                ok: true,
                status: 200,
                body,
                headers: {
                  'content-type': 'application/json',
                  'x-proxy-cache': 'HIT',
                },
              };
            }
          } else {
          }
        } catch (e) {
          console.error(`[NUGET_PROXY] Cache check error for ${targetUrl}:`, e);
        }
      }

      // Request stream for nupkg to handle large files better
      const result = await proxyFetchWithAuth(repo, targetUrl, {
        stream: isNupkg,
      });
      const resAny = result as any;

      // Cache .nupkg files or metadata
      if ((isNupkg || isMetadata) && result.ok) {
        let buf: Buffer | null = null;

        if (resAny.stream) {
          const chunks: any[] = [];
          const stream = resAny.stream;

          // Handle both Node.js streams and Web Streams
          if (typeof stream.getReader === 'function') {
            const reader = stream.getReader();
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(Buffer.from(value));
            }
          } else {
            for await (const chunk of stream) {
              chunks.push(Buffer.from(chunk));
            }
          }
          buf = Buffer.concat(chunks);
        } else if (resAny.body) {
          if (Buffer.isBuffer(resAny.body)) {
            buf = resAny.body;
          } else if (typeof resAny.body === 'string') {
            buf = Buffer.from(resAny.body);
          } else {
            buf = Buffer.from(JSON.stringify(resAny.body));
          }
        }

        if (buf && buf.length > 0) {
          const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
          const cacheEnabled = repo.config?.cacheEnabled !== false;
          if (cacheEnabled && cacheMaxAgeDays > 0) {
            if (isNupkg) {
              // Try to derive canonical name/version pair so the hosted-style
              // download path (name/version) can find the cached artifact.
              try {
                const parts = cleanUrl.split('/').filter(Boolean);
                let nameFromPath: string | null = null;
                let versionFromPath: string | null = null;

                if (parts.length >= 3) {
                  // Typical pattern: [...prefix..., <id>, <version>, <file>]
                  const candidateName = parts[parts.length - 3];
                  const candidateVersion = parts[parts.length - 2];
                  const filename = parts[parts.length - 1] || '';
                  if (
                    filename.startsWith(candidateName) &&
                    filename.includes(candidateVersion)
                  ) {
                    nameFromPath = candidateName;
                    versionFromPath = candidateVersion;
                  }
                }

                // Fallback: try parsing filename like "pkgname.1.2.3.nupkg"
                if (!nameFromPath) {
                  const filename = cleanUrl.split('/').pop() || '';
                  const m = filename.match(/^(.+)\.(.+)\.nupkg$/i);
                  if (m) {
                    nameFromPath = m[1];
                    versionFromPath = m[2];
                  }
                }

                if (nameFromPath && versionFromPath) {
                  const fileName = `${nameFromPath}.${versionFromPath}.nupkg`;
                  const canonicalKey = buildKey(
                    'nuget',
                    repo.id,
                    'proxy',
                    nameFromPath,
                    versionFromPath,
                    fileName,
                  );

                  try {
                    await storage.save(canonicalKey, buf);

                    // Index artifact so it appears in listings/search
                    if (context.indexArtifact) {
                      try {
                        await context.indexArtifact(repo, {
                          ok: true,
                          id: `${nameFromPath}:${versionFromPath}`,
                          metadata: {
                            name: nameFromPath,
                            version: versionFromPath,
                            storageKey: canonicalKey,
                            size: buf.length,
                          },
                        });
                      } catch (ie) {
                        console.warn('[NUGET_PROXY] indexArtifact failed:', ie);
                      }
                    }
                  } catch (e) {
                    console.error(
                      `[NUGET_PROXY] Failed to cache canonical key ${canonicalKey}:`,
                      e,
                    );
                  }
                } else {
                  // Fallback to raw URL key only if we can't derive canonical name/version
                  const keyId = buildKey('nuget', repo.id, 'proxy', cleanUrl);
                  await storage.save(keyId, buf);
                }
              } catch (deriveErr) {
                console.warn(
                  '[NUGET_PROXY] Error during cache key derivation:',
                  deriveErr,
                );
                // Final fallback
                const keyId = buildKey('nuget', repo.id, 'proxy', cleanUrl);
                await storage.save(keyId, buf);
              }
            } else {
              // Cache metadata
              const keyId = buildKey('nuget', repo.id, 'proxy', cleanUrl);
              await storage.save(keyId, buf);
            }
          } else {
          }

          // If it's metadata, we might need to rewrite it before returning
          let finalBody: any = buf;
          if (isMetadata && cleanUrl.endsWith('index.json')) {
            finalBody = processServiceIndex(repo, buf);
          }

          return { ...result, body: finalBody, stream: undefined } as any;
        }
      }

      return result;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
