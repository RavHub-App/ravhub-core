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
  const { processSimpleIndex } = initMetadata(context);
  const { storage } = context;

  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      // Handle PyPI Proxy Magic
      // URL format: pypi-proxy/<encoded-upstream-url>
      if (url.startsWith('pypi-proxy/')) {
        const encodedUrl = url.replace('pypi-proxy/', '');
        if (encodedUrl) {
          const targetUrl = decodeURIComponent(encodedUrl);

          // Check cache
          // Strip fragment and query from the URL for the cache key to ensure clean filenames
          const urlForCache = targetUrl.split('#')[0].split('?')[0];

          // Try to derive canonical key: pypi/<repoId>/proxy/<packageName>/<filename>
          let canonicalKey: string | null = null;
          try {
            const filename = urlForCache.split('/').pop();
            if (filename) {
              // PyPI filenames usually start with the package name, e.g. requests-2.25.1.tar.gz
              // We can try to extract the package name.
              // For now, let's at least put it in a folder named after the package if we can find it in the URL.
              const parts = urlForCache.split('/').filter(Boolean);
              // Typical PyPI URL: .../packages/xx/yy/zzzzzzzz/packageName-version.tar.gz
              // The package name is often the first part of the filename before the first hyphen.
              const pkgName = filename.split('-')[0].toLowerCase();
              if (pkgName) {
                canonicalKey = buildKey(
                  'pypi',
                  repo.id,
                  'proxy',
                  pkgName,
                  filename,
                );
              }
            }
          } catch (e) {}

          const keyId = buildKey(
            'pypi',
            repo.id,
            'proxy',
            'magic',
            urlForCache,
          );
          const cacheEnabled = repo.config?.cacheEnabled !== false;

          try {
            let cached =
              cacheEnabled && canonicalKey
                ? await storage.get(canonicalKey)
                : null;
            if (!cached && cacheEnabled) cached = await storage.get(keyId);

            if (cached) {
              // Revalidate with upstream (HEAD request)
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
                    // Fall through to download
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
                    `[PyPI] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
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
                  `[PyPI] Revalidation error: ${revalErr}. Serving cache as fallback.`,
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
            }
          } catch (e) {
            /* ignore */
          }

          const result = await proxyFetchWithAuth(repo, targetUrl);

          if (result.ok && 'body' in result && result.body) {
            const body = result.body;
            const buf = Buffer.isBuffer(body)
              ? body
              : Buffer.from(body as string);
            if (buf.length > 0) {
              const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
              if (cacheEnabled && cacheMaxAgeDays > 0) {
                const storageKey = canonicalKey || keyId;
                try {
                  await storage.save(storageKey, buf);

                  // Index artifact if available
                  if (context.indexArtifact) {
                    const filename = urlForCache.split('/').pop() || 'unknown';
                    const pkgName = filename.split('-')[0].toLowerCase();

                    await context.indexArtifact(repo, {
                      ok: true,
                      id: `${pkgName}:${filename}`,
                      metadata: {
                        name: pkgName,
                        version: '0.0.0',
                        filename: filename,
                        storageKey: storageKey,
                        size: buf.length,
                      },
                    });
                  }
                } catch (e) {
                  console.error(`[PyPI] Failed to cache ${storageKey}:`, e);
                }
              }
            }
            return { ...result, body: buf };
          }
          return result;
        }
      }

      // Check cache for standard package files or metadata
      const cleanUrl = url.split('?')[0].split('#')[0];
      const isPackage = /\.(whl|tar\.gz|zip|egg|bz2)$/i.test(cleanUrl);
      const isMetadata =
        !isPackage && (url.includes('/simple/') || url.endsWith('/'));
      const cacheEnabled = repo.config?.cacheEnabled !== false;

      if ((isPackage || isMetadata) && cacheEnabled) {
        const keyId = buildKey(
          'pypi',
          repo.id,
          'proxy',
          isPackage ? 'file' : 'metadata',
          cleanUrl,
        );
        try {
          const cached = await storage.get(keyId);
          if (cached) {
            // For packages, we revalidate. For metadata, maybe we should too?
            // Actually, let's revalidate metadata too to be safe, but serve from cache if upstream is down.
            try {
              const headRes = await proxyFetchWithAuth(repo, url, {
                method: 'HEAD',
                timeoutMs: 5000,
              });
              if (headRes.ok && headRes.headers) {
                const contentLength = headRes.headers['content-length'];
                if (
                  isPackage &&
                  contentLength &&
                  parseInt(contentLength) !== cached.length
                ) {
                  // Fall through to download
                } else {
                  let body: any = cached;
                  if (isMetadata) {
                    body = processSimpleIndex(repo, cached.toString());
                  }
                  return {
                    ok: true,
                    status: 200,
                    body,
                    headers: {
                      'content-type': isMetadata
                        ? 'text/html'
                        : 'application/octet-stream',
                      'x-proxy-cache': 'HIT',
                    },
                  };
                }
              } else {
                console.warn(
                  `[PyPI] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
                );
                let body: any = cached;
                if (isMetadata) {
                  body = processSimpleIndex(repo, cached.toString());
                }
                return {
                  ok: true,
                  status: 200,
                  body,
                  headers: {
                    'content-type': isMetadata
                      ? 'text/html'
                      : 'application/octet-stream',
                    'x-proxy-cache': 'HIT',
                  },
                };
              }
            } catch (revalErr) {
              console.warn(
                `[PyPI] Revalidation error: ${revalErr}. Serving cache as fallback.`,
              );
              let body: any = cached;
              if (isMetadata) {
                body = processSimpleIndex(repo, cached.toString());
              }
              return {
                ok: true,
                status: 200,
                body,
                headers: {
                  'content-type': isMetadata
                    ? 'text/html'
                    : 'application/octet-stream',
                  'x-proxy-cache': 'HIT',
                },
              };
            }
          } else {
          }
        } catch (e) {
          console.error(`[PyPI] Cache check error for ${url}:`, e);
        }
      }

      const result = await proxyFetchWithAuth(repo, url);

      // Cache package files or metadata
      if (
        (isPackage || isMetadata) &&
        result.ok &&
        'body' in result &&
        result.body
      ) {
        const body = result.body;
        let buf: Buffer;
        if (Buffer.isBuffer(body)) {
          buf = body;
        } else if (typeof body === 'string') {
          buf = Buffer.from(body);
        } else {
          buf = Buffer.from(JSON.stringify(body));
        }
        if (buf.length > 0) {
          const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
          if (cacheEnabled && cacheMaxAgeDays > 0) {
            // Use the URL as the key identifier (encoded)
            const keyId = buildKey(
              'pypi',
              repo.id,
              'proxy',
              isPackage ? 'file' : 'metadata',
              cleanUrl,
            );
            try {
              await storage.save(keyId, buf);

              // Index artifact if available
              if (isPackage && context.indexArtifact) {
                const filename = cleanUrl.split('/').pop() || 'unknown';
                await context.indexArtifact(repo, {
                  name: filename,
                  version: '0.0.0',
                  filename: filename,
                  storageKey: keyId,
                  size: buf.length,
                });
              }
            } catch (e) {
              console.error(`[PyPI] Failed to cache ${keyId}:`, e);
            }
          } else {
          }
        }

        let finalBody: string | Buffer = buf;
        if (isMetadata) {
          finalBody = processSimpleIndex(repo, buf.toString());
        }
        return { ...result, body: finalBody };
      }

      return result;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
