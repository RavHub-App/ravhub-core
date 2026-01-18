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
import { buildKey } from '../utils/key-utils';

export function initProxy(context: PluginContext) {
  const { processMetadata } = initMetadata(context);

  const proxyFetch = async (repo: Repository, url: string, options?: any) => {
    const cleanUrl = url.split('?')[0].split('#')[0];
    const key = buildKey('composer', repo.id, 'proxy', cleanUrl);

    // Try to get from storage first
    if (context.storage) {
      const cached = await context.storage.get(key);
      if (cached) {
        const isJson = cleanUrl.endsWith('.json');
        let body = cached;
        if (isJson) {
          try {
            const upstreamUrl = repo.config.proxyUrl;
            const cleanUpstream =
              upstreamUrl && upstreamUrl.endsWith('/')
                ? upstreamUrl.slice(0, -1)
                : upstreamUrl;
            const processed = await processMetadata(
              repo,
              url,
              cached,
              cleanUpstream || '',
            );
            body = Buffer.from(processed);
          } catch (e) {
            console.error(
              '[ComposerPlugin] Failed to process cached metadata:',
              e,
            );
            // Fallback to cached raw if processing fails
          }
        }
        return {
          ok: true,
          body: isJson ? JSON.parse(body.toString()) : body,
          headers: {
            'content-type': isJson
              ? 'application/json'
              : 'application/octet-stream',
            'content-length': body.length.toString(),
            'x-proxy-cache': 'HIT',
          },
        };
      }
    }

    // Check if it's a dist download (based on path encoding)
    // Format: dist/<base64Url>/<vendor>/<package>/<version>.zip
    if (url.startsWith('dist/')) {
      const parts = url.split('/');
      if (parts.length >= 5) {
        const base64Url = parts[1];
        const vendor = parts[2];
        const pkg = parts[3];
        const version = parts[4].replace('.zip', ''); // remove extension if present

        try {
          const targetUrl = Buffer.from(base64Url, 'base64').toString('utf8');
          const packageName = `${vendor}/${pkg}`;

          const { initStorage } = require('../storage/storage');
          const { proxyDownload } = initStorage(context);
          const result = await proxyDownload(
            repo,
            targetUrl,
            packageName,
            version,
          );
          if (result.ok && result.body) {
            return {
              ok: true,
              status: 200,
              body: result.body,
              headers: {
                'content-type': result.contentType || 'application/zip',
                'x-proxy-cache': result.skipCache ? 'HIT' : 'MISS',
              },
            };
          }
          return result;
        } catch (e) {
          console.error('[ComposerPlugin] Failed to decode dist URL:', e);
        }
      }
    }

    // Check if it's a dist download (based on options - legacy/fallback)
    if (options?.packageName && options?.version) {
      const { initStorage } = require('../storage/storage');
      const { proxyDownload } = initStorage(context);
      return proxyDownload(repo, url, options.packageName, options.version);
    }

    try {
      let proxyFetchWithAuth;
      try {
        proxyFetchWithAuth =
          require('../../../../../plugins-core/proxy-helper').default;
      } catch (e) {
        console.error('[ComposerPlugin] Failed to load proxy-helper:', e);
        throw e;
      }

      const response = await proxyFetchWithAuth(repo, url);

      if (response && response.ok) {
        const contentType = response.headers?.['content-type'] || '';
        const isJson =
          contentType.includes('application/json') || url.endsWith('.json');

        if (isJson && (response.body || response.json)) {
          const content = response.json || response.body;
          const upstreamUrl = repo.config.proxyUrl;
          const cleanUpstream =
            upstreamUrl && upstreamUrl.endsWith('/')
              ? upstreamUrl.slice(0, -1)
              : upstreamUrl;

          if (cleanUpstream) {
            try {
              const processed = await processMetadata(
                repo,
                url,
                content,
                cleanUpstream,
              );
              const processedBuffer = Buffer.from(processed);

              // Save ORIGINAL metadata to storage
              if (context.storage) {
                const bodyBuffer = Buffer.isBuffer(response.body)
                  ? response.body
                  : Buffer.from(
                      typeof response.body === 'string'
                        ? response.body
                        : JSON.stringify(response.body),
                    );
                await context.storage.save(key, bodyBuffer);
              }

              return {
                ...response,
                body: processed,
                // Ensure we don't send conflicting headers if size changed
                headers: {
                  ...response.headers,
                  'content-length': processedBuffer.length.toString(),
                  'x-proxy-cache': 'MISS',
                },
              };
            } catch (e) {
              console.error('[ComposerPlugin] Error processing metadata:', e);
            }
          }
        } else if (response.body && context.storage) {
          // Save non-JSON body to storage
          const bodyBuffer = Buffer.isBuffer(response.body)
            ? response.body
            : Buffer.from(
                typeof response.body === 'string'
                  ? response.body
                  : JSON.stringify(response.body),
              );
          await context.storage.save(key, bodyBuffer);
        }
      }

      return response;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
