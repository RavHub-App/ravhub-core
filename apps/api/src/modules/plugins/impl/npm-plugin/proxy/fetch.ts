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
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import { buildKey } from '../utils/key-utils';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

export function initProxy(context: PluginContext) {
  const { storage } = context;
  const { processMetadata } = initMetadata(context);

  const proxyFetch = async (repo: Repository, url: string) => {
    let cleanPath = url.split('?')[0].split('#')[0];
    // Canonicalize if it's a full URL
    if (cleanPath.startsWith('http')) {
      try {
        const u = new URL(cleanPath);
        let p = u.pathname;
        if (p.startsWith('/repository/')) {
          const parts = p.split('/').filter(Boolean);
          if (parts.length >= 2) {
            p = parts.slice(2).join('/');
          }
        }
        cleanPath = p.startsWith('/') ? p.slice(1) : p;
      } catch (e) { }
    }

    const storagePath =
      !cleanPath.includes('/-/') && !cleanPath.endsWith('.tgz')
        ? `${cleanPath}/package.json`
        : cleanPath;
    const proxyKey = buildKey('npm', repo.id, 'proxy', storagePath);
    const cacheEnabled = repo.config?.cacheEnabled !== false;

    const lockKey = `npm:proxy:${storagePath}`;
    return await runWithLock(context, lockKey, async () => {
      // 1. Try persistent storage first (Inside lock to handle seconder)
      try {
        const cachedData = await storage.get(proxyKey);
        if (cachedData && cacheEnabled) {
          if (storagePath.endsWith('.tgz')) {
            // Revalidate tarballs with HEAD request (fast)
            try {
              const headRes = await proxyFetchWithAuth(repo, url, {
                method: 'HEAD',
                timeoutMs: 5000,
              });
              if (headRes.ok && headRes.headers) {
                const contentLength = headRes.headers['content-length'];
                if (
                  contentLength &&
                  parseInt(contentLength) !== cachedData.length
                ) {
                  // Fall through to fetch from upstream
                } else {
                  return {
                    ok: true,
                    status: 200,
                    headers: {
                      'content-type': 'application/octet-stream',
                      'x-proxy-cache': 'HIT',
                    },
                    body: cachedData,
                  };
                }
              } else {
                return {
                  ok: true,
                  status: 200,
                  headers: {
                    'content-type': 'application/octet-stream',
                    'x-proxy-cache': 'HIT',
                  },
                  body: cachedData,
                };
              }
            } catch (revalErr) {
              return {
                ok: true,
                status: 200,
                headers: {
                  'content-type': 'application/octet-stream',
                  'x-proxy-cache': 'HIT',
                },
                body: cachedData,
              };
            }
          } else if (storagePath.endsWith('package.json')) {
            // Check TTL for mutable metadata
            const ttlSeconds = repo.config?.cacheTtlSeconds ?? 300;
            const meta = typeof storage.getMetadata === 'function'
              ? await storage.getMetadata(proxyKey).catch(() => null)
              : null;
            if (meta) {
              const ageSeconds = (Date.now() - meta.mtime.getTime()) / 1000;
              if (ageSeconds <= ttlSeconds) {
                let body = cachedData;
                try {
                  body = processMetadata(repo, cachedData);
                } catch (e) {
                  // ignore
                }
                return {
                  ok: true,
                  status: 200,
                  headers: {
                    'content-type': 'application/json',
                    'x-proxy-cache': 'HIT',
                  },
                  body,
                };
              }
            }
          }
        }
      } catch (e) { }

      // 2. Fetch from upstream
      try {
        const cleanUrl = url.split('?')[0].split('#')[0];
        const result = await proxyFetchWithAuth(repo, cleanUrl);

        if (result.ok && (result as any).body) {
          const isMetadata =
            result.headers &&
            result.headers['content-type']?.includes('application/json');

          // 3. Cache to persistent storage (ORIGINAL data)
          const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
          if (cacheEnabled && cacheMaxAgeDays > 0 && (result as any).body) {
            let dataToSave: any = (result as any).body;
            if (typeof dataToSave === 'object' && !Buffer.isBuffer(dataToSave)) {
              dataToSave = JSON.stringify(dataToSave);
            }
            await storage.save(proxyKey, dataToSave);

            // Index artifact if it's a tarball
            if (storagePath.endsWith('.tgz') && context.indexArtifact) {
              try {
                await context.indexArtifact(repo, {
                  ok: true,
                  id: storagePath,
                  metadata: {
                    storageKey: proxyKey,
                    size: Buffer.isBuffer(dataToSave)
                      ? dataToSave.length
                      : Buffer.byteLength(String(dataToSave)),
                    path: storagePath,
                  },
                });
              } catch (e) { }
            }
          }

          // Process metadata for the response
          if (isMetadata && (result as any).body) {
            (result as any).body = processMetadata(repo, (result as any).body);
          }
        }

        return result;
      } catch (err: any) {
        return { ok: false, message: String(err) };
      }
    });
  };

  return { proxyFetch };
}
