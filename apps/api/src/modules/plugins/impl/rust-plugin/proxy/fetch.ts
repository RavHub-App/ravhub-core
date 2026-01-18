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
import { buildKey } from '../utils/key-utils';

export function initProxy(context: PluginContext) {
  const proxyFetch = async (repo: Repository, url: string, options?: any) => {
    try {
      let proxyFetchWithAuth;
      try {
        proxyFetchWithAuth =
          require('../../../../../plugins-core/proxy-helper').default;
      } catch (e) {
        console.error('[RustPlugin] Failed to load proxy-helper:', e);
        throw e;
      }

      // Helper to get base URL
      const getBaseUrl = () => {
        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        return `${proto}://${host}/repository/${repo.name}`;
      };

      // Use a consistent URL check. In the new architecture, the repo name is already stripped from the path.
      // We check for 'rust-proxy/' or just the bare prefix if the repo name was 'rust-proxy'.
      const pathUrl = url.startsWith('/') ? url.slice(1) : url;

      // Handle Magic Proxy for DL (Crate Downloads)
      // Format: dl/<base64-template>/<crate>/<version> or rust-proxy/dl/...
      if (pathUrl.startsWith('dl/') || pathUrl.startsWith('rust-proxy/dl/')) {
        const parts = pathUrl.replace(/^rust-proxy\//, '').split('/');
        if (parts.length >= 4) {
          const encodedTemplate = parts[1];
          const crate = parts[2];
          const version = parts[3];

          const template = Buffer.from(encodedTemplate, 'base64').toString(
            'utf-8',
          );

          let targetUrl;
          if (template.includes('{crate}') || template.includes('{version}')) {
            targetUrl = template
              .replace('{crate}', crate)
              .replace('{version}', version);
          } else {
            // It's a prefix
            const prefix = template.replace(/\/$/, '');
            targetUrl = `${prefix}/${crate}/${version}/download`;
          }

          // Use proxyDownload for caching
          const { initStorage } = require('../storage/storage');
          const { proxyDownload } = initStorage(context);
          const result = await proxyDownload(repo, targetUrl, crate, version);
          if (result.ok && result.data) {
            return {
              ok: true,
              status: 200,
              body: result.data,
              headers: {
                'content-type':
                  result.contentType || 'application/octet-stream',
                'x-proxy-cache': result.skipCache ? 'HIT' : 'MISS',
              },
            };
          }
          return result;
        }
      }

      // Handle Magic Proxy for API (Publish, etc)
      // Format: api/<base64-base>/<rest-of-path> or rust-proxy/api/...
      if (pathUrl.startsWith('api/') || pathUrl.startsWith('rust-proxy/api/')) {
        const parts = pathUrl.replace(/^rust-proxy\//, '').split('/');
        if (parts.length >= 2 && parts[1].length > 10) {
          // likely base64
          const encodedBase = parts[1];
          const rest = parts.slice(2).join('/');

          const upstreamBase = Buffer.from(encodedBase, 'base64').toString(
            'utf-8',
          );
          const targetUrl = upstreamBase.endsWith('/')
            ? `${upstreamBase}${rest}`
            : `${upstreamBase}/${rest}`;

          return await proxyFetchWithAuth(repo, targetUrl);
        }
      }

      // Handle standard Crates.io download path
      // api/v1/crates/<crate>/<version>/download
      // Allow optional leading slash, and ignore query params
      // Also support dl/ crate/ version/ download (some mirrors)
      const cleanUrlForMatch = url.split('?')[0];
      const downloadMatch = cleanUrlForMatch.match(
        /^\/?api\/v1\/crates\/([^/]+)\/([^/]+)\/download$/,
      );

      if (downloadMatch) {
        const crate = downloadMatch[1];
        const version = downloadMatch[2];

        const { initStorage } = require('../storage/storage');
        const { proxyDownload } = initStorage(context);

        const upstream = repo.config?.proxyUrl || repo.config?.url;
        if (!upstream) {
          console.error('[RustPlugin] No proxyUrl configured');
          return { ok: false, message: 'No proxyUrl configured' };
        }
        const cleanUpstream = upstream.endsWith('/')
          ? upstream.slice(0, -1)
          : upstream;
        // Ensure we don't double slash if url has leading slash
        const targetPath = url.startsWith('/') ? url.slice(1) : url;
        const targetUrl = `${cleanUpstream}/${targetPath}`;

        const result = await proxyDownload(repo, targetUrl, crate, version);

        // If proxyDownload returns a redirect (302), it means fetch didn't follow it or something else happened.
        // But we want to cache the content.
        // If result.ok is true, we have the content.

        if (result.ok && result.data) {
          return {
            ok: true,
            status: 200,
            body: result.data,
            headers: {
              'content-type': result.contentType || 'application/octet-stream',
              'x-proxy-cache': result.skipCache ? 'HIT' : 'MISS',
            },
          };
        }
        return result;
      } else {
      }

      // Detect crate download: name/version (e.g. my-crate/0.1.0)
      // This is the standard path for direct downloads in this plugin
      const pathParts = url.split('/');
      if (pathParts.length === 2) {
        const [crate, version] = pathParts;
        const { initStorage } = require('../storage/storage');
        const { proxyDownload } = initStorage(context);

        const upstream = repo.config?.proxyUrl || repo.config?.url;
        if (!upstream) {
          return { ok: false, message: 'No proxyUrl configured' };
        }
        const cleanUpstream = upstream.endsWith('/')
          ? upstream.slice(0, -1)
          : upstream;
        const targetUrl = `${cleanUpstream}/${crate}/${version}`;

        const result = await proxyDownload(repo, targetUrl, crate, version);
        if (result.ok && result.data) {
          return {
            ok: true,
            status: 200,
            body: result.data,
            headers: {
              'content-type': result.contentType || 'application/octet-stream',
            },
          };
        }
        return result;
      }

      // Default fetch (Index files, config.json)
      const fileUrl = url.split('?')[0].split('#')[0];
      const key = buildKey('rust', repo.id, 'proxy', fileUrl || 'root');

      if (context.storage) {
        const cached = await context.storage.get(key);
        if (cached) {
          let body = cached;
          if (url.endsWith('config.json')) {
            try {
              const json = JSON.parse(cached.toString());
              const baseUrl = getBaseUrl();

              if (json.dl) {
                const encodedDl = Buffer.from(json.dl).toString('base64');
                json.dl = `${baseUrl}/rust-proxy/dl/${encodedDl}/{crate}/{version}`;
              }

              if (json.api) {
                const encodedApi = Buffer.from(json.api).toString('base64');
                json.api = `${baseUrl}/rust-proxy/api/${encodedApi}`;
              }

              body = Buffer.from(JSON.stringify(json));
            } catch (e) {
              console.error(
                '[RustPlugin] Failed to rewrite cached config.json',
                e,
              );
            }
          }

          return {
            ok: true,
            status: 200,
            body,
            headers: {
              'content-type': url.endsWith('.json')
                ? 'application/json'
                : 'text/plain',
              'x-proxy-cache': 'HIT',
            },
          };
        }
      }

      const result = await proxyFetchWithAuth(repo, url);

      // Rewrite config.json and cache original
      if (result.ok) {
        // Cache original
        if (context.storage) {
          try {
            let contentToCache = result.body;
            if (typeof contentToCache === 'string')
              contentToCache = Buffer.from(contentToCache);
            else if (
              typeof contentToCache === 'object' &&
              !Buffer.isBuffer(contentToCache)
            ) {
              contentToCache = Buffer.from(JSON.stringify(contentToCache));
            }

            if (contentToCache) {
              await context.storage.save(key, contentToCache);
            }
          } catch (e) {
            console.error('[RustPlugin] Failed to cache index file', e);
          }
        }

        if (url.endsWith('config.json')) {
          try {
            const json =
              typeof result.body === 'string'
                ? JSON.parse(result.body)
                : Buffer.isBuffer(result.body)
                  ? JSON.parse(result.body.toString())
                  : result.body;
            const baseUrl = getBaseUrl();

            if (json.dl) {
              const encodedDl = Buffer.from(json.dl).toString('base64');
              json.dl = `${baseUrl}/rust-proxy/dl/${encodedDl}/{crate}/{version}`;
            }

            if (json.api) {
              const encodedApi = Buffer.from(json.api).toString('base64');
              json.api = `${baseUrl}/rust-proxy/api/${encodedApi}`;
            }

            result.body = JSON.stringify(json);
            if (result.headers) {
              result.headers['content-length'] = String(
                Buffer.byteLength(result.body),
              );
            }
          } catch (e) {
            console.error('[RustPlugin] Failed to rewrite config.json', e);
          }
        }
      }

      return result;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
