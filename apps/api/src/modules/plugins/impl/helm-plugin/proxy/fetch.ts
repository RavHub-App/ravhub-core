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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import * as yaml from 'js-yaml';
import { buildKey } from '../utils/key-utils';
import proxyFetchWithAuth from '../../../../../plugins-core/proxy-helper';

export function initProxy(context: PluginContext) {
  const { storage } = context;

  return {
    proxyFetch: async (repo: any, url: string) => {
      const cacheEnabled = repo.config?.cacheEnabled !== false;

      // Handle magic proxy path for absolute URLs
      if (url.startsWith('helm-proxy/')) {
        const encodedUrl = url.replace('helm-proxy/', '');
        try {
          const targetUrl = Buffer.from(encodedUrl, 'base64').toString('utf-8');

          // Check cache for magic proxy
          const urlForCache = targetUrl.split('#')[0].split('?')[0];
          const keyId = buildKey(
            'helm',
            repo.id,
            'proxy',
            'magic',
            urlForCache,
          );

          try {
            const cached = cacheEnabled ? await storage.get(keyId) : null;
            if (cached) {
              // Revalidate with upstream (HEAD request)
              try {
                const headRes = await proxyFetchWithAuth(repo, targetUrl, {
                  method: 'HEAD',
                  timeoutMs: 5000,
                });
                if (headRes.ok) {
                  const contentLength = headRes.headers?.['content-length'];
                  if (
                    contentLength &&
                    parseInt(contentLength) !== cached.length
                  ) {
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
                    `[HELM_PROXY] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
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
                  `[HELM_PROXY] Revalidation error. Serving cache as fallback.`,
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

          const response = await proxyFetchWithAuth(repo, targetUrl);
          if (!response.ok) return response;

          const body = (response as any).body;
          const buf = Buffer.isBuffer(body)
            ? body
            : Buffer.from(body as string);

          // Cache magic proxy result
          if (buf.length > 0 && cacheEnabled) {
            try {
              await storage.save(keyId, buf);
              if (context.indexArtifact) {
                const filename = urlForCache.split('/').pop() || 'unknown';
                let name = filename;
                let version = '0.0.0';
                const match = filename.match(/^(.*)-(\d+\..*)\.tgz$/);
                if (match) {
                  name = match[1];
                  version = match[2];
                }

                await context.indexArtifact(repo, {
                  ok: true,
                  id: `${name}:${version}`,
                  metadata: {
                    name,
                    version,
                    filename,
                    storageKey: keyId,
                    size: buf.length,
                  },
                });
              }
            } catch (e) {
              console.error(`[HELM_PROXY] Failed to cache ${keyId}:`, e);
            }
          }
          return {
            ok: true,
            status: response.status,
            body: buf,
            headers: response.headers,
          };
        } catch (e: any) {
          return { ok: false, status: 500, body: e.message };
        }
      }

      const upstreamUrl = repo.config?.proxyUrl || repo.config?.url;
      const targetUrl = url.match(/^https?:\/\//)
        ? url
        : `${upstreamUrl?.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

      // Check cache for standard chart downloads or index.yaml
      const isChart =
        /\.(tgz|prov)(\?.*)?$/i.test(url) || url.endsWith('.tar.gz');
      const isIndex = url.endsWith('index.yaml');

      if ((isChart || isIndex) && cacheEnabled) {
        const urlForCache = url.split('#')[0].split('?')[0];
        const keyId = buildKey('helm', repo.id, 'proxy', 'file', urlForCache);
        try {
          const cached = await storage.get(keyId);
          if (cached) {
            if (isChart) {
              try {
                const headRes = await proxyFetchWithAuth(repo, targetUrl, {
                  method: 'HEAD',
                  timeoutMs: 5000,
                });
                if (headRes.ok) {
                  const cl = headRes.headers?.['content-length'];
                  if (cl && parseInt(cl) !== cached.length) {
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
              } catch (e) {
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
              // Rewrite index.yaml on cache hit
              try {
                const content = cached.toString('utf-8');
                const index = yaml.load(content) as any;
                if (index && index.entries) {
                  for (const chartName in index.entries) {
                    for (const version of index.entries[chartName]) {
                      if (version.urls) {
                        version.urls = version.urls.map((u: string) => {
                          if (u.match(/^https?:\/\//)) {
                            return `helm-proxy/${Buffer.from(u).toString('base64')}`;
                          }
                          return u;
                        });
                      }
                    }
                  }
                  return {
                    ok: true,
                    status: 200,
                    body: Buffer.from(yaml.dump(index)),
                    headers: {
                      'content-type': 'text/yaml',
                      'x-proxy-cache': 'HIT',
                    },
                  };
                }
              } catch (e) {
                /* fallback */
              }
              return {
                ok: true,
                status: 200,
                body: cached,
                headers: {
                  'content-type': 'text/yaml',
                  'x-proxy-cache': 'HIT',
                },
              };
            }
          }
        } catch (e) {
          /* ignore */
        }
      }

      const result = await proxyFetchWithAuth(repo, targetUrl);
      if (!result.ok) return result;

      const body = (result as any).body;
      const originalBuffer = Buffer.isBuffer(body)
        ? body
        : Buffer.from(body as string);
      let finalBuffer = originalBuffer;

      // Rewrite index.yaml
      if (url.endsWith('index.yaml')) {
        try {
          const index = yaml.load(originalBuffer.toString('utf-8')) as any;
          if (index && index.entries) {
            for (const chartName in index.entries) {
              for (const version of index.entries[chartName]) {
                if (version.urls) {
                  version.urls = version.urls.map((u: string) => {
                    if (u.match(/^https?:\/\//)) {
                      return `helm-proxy/${Buffer.from(u).toString('base64')}`;
                    }
                    return u;
                  });
                }
              }
            }
            finalBuffer = Buffer.from(yaml.dump(index));
          }
        } catch (e) {
          console.error('Error rewriting index.yaml', e);
        }
      }

      // Cache if successful
      if ((isChart || isIndex) && result.ok) {
        const keyId = buildKey(
          'helm',
          repo.id,
          'proxy',
          'file',
          url.split('?')[0],
        );
        try {
          await storage.save(keyId, originalBuffer);
          if (isChart && context.indexArtifact) {
            const filename = url.split('/').pop() || 'unknown';
            let name = filename,
              version = '0.0.0';
            const match = filename.match(/^(.*)-(\d+\..*)\.tgz$/);
            if (match) {
              name = match[1];
              version = match[2];
            }
            await context.indexArtifact(repo, {
              ok: true,
              id: `${name}:${version}`,
              metadata: {
                name,
                version,
                filename,
                storageKey: keyId,
                size: originalBuffer.length,
              },
            });
          }
        } catch (e) {
          console.error(`[HELM_PROXY] Cache failed for ${keyId}:`, e);
        }
      }

      return {
        ...result,
        body: finalBuffer,
        headers: {
          ...(result.headers || {}),
          'content-type': isIndex
            ? 'text/yaml'
            : result.headers?.['content-type'] || 'application/octet-stream',
        },
      };
    },
  };
}
