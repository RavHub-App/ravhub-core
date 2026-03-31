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

import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import { getNpmFile, getNpmMetadataPath } from './storage-helpers';

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<{
  status?: number;
  body?: Buffer;
  headers?: Record<string, string>;
}>;

export function createNpmDownloader(
  context: PluginContext,
  pendingDownloads: Map<string, Promise<any>>,
  proxyFetch?: ProxyFetch,
) {
  const { storage } = context;

  async function resolveRepo(id: string) {
    if (!context.getRepo) {
      return null;
    }
    try {
      return await context.getRepo(id);
    } catch (error) {
      console.warn(
        `[NPM] Failed to resolve repository ${id}: ${String(error)}`,
      );
      return null;
    }
  }

  async function downloadImpl(repo: Repository, path: string): Promise<any> {
    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      if (!context.getRepo) {
        return { ok: false, message: 'Context not ready' };
      }

      for (const id of members) {
        const member = await resolveRepo(id);
        if (!member) {
          continue;
        }

        try {
          if (member.type === 'hosted') {
            const result = await downloadImpl(member, path);
            if (result.ok) {
              return result;
            }
          } else if (member.type === 'proxy' && proxyFetch) {
            const result = await proxyFetch(member, path);
            if (result.status === 200 || result.status === 304) {
              return {
                ok: true,
                data: result.body,
                contentType:
                  result.headers?.['content-type'] ||
                  'application/octet-stream',
              };
            }
          }
        } catch (error) {
          console.warn(
            `[NPM] Group download failed for member ${member.id}: ${String(error)}`,
          );
        }
      }

      return { ok: false, message: 'Not found in group' };
    }

    if (repo.type === 'proxy') {
      if (!proxyFetch) {
        return { ok: false, message: 'Proxy not available' };
      }

      const proxyKey = buildKey('npm', repo.id, 'proxy', path);
      const cached = await Promise.resolve(storage.get(proxyKey)).catch(
        () => null,
      );
      if (cached) {
        return {
          ok: true,
          data: cached,
          contentType: 'application/octet-stream',
        };
      }

      const coalescingKey = `npm:${repo.id}:${path}`;
      if (pendingDownloads.has(coalescingKey)) {
        return pendingDownloads.get(coalescingKey);
      }

      const fetchTask = (async () => {
        try {
          const result = await proxyFetch(repo, path);
          if (result.status === 200 || result.status === 304) {
            if (result.body) {
              try {
                await storage.save(proxyKey, Buffer.from(result.body));
              } catch (error) {
                console.warn(
                  `[NPM] Failed to cache proxied payload ${path}: ${String(error)}`,
                );
              }
            }

            return {
              ok: true,
              data: result.body,
              contentType:
                result.headers?.['content-type'] || 'application/octet-stream',
            };
          }

          return { ok: false, message: 'Not found in upstream' };
        } finally {
          pendingDownloads.delete(coalescingKey);
        }
      })();

      pendingDownloads.set(coalescingKey, fetchTask);
      return fetchTask;
    }

    const cleanPath = path.split('?')[0].split('#')[0];
    const storagePath = getNpmMetadataPath(cleanPath);
    const data = await getNpmFile(storage, repo, storagePath);
    if (!data) {
      return { ok: false, message: 'Not found' };
    }

    return {
      ok: true,
      data,
      contentType: path.endsWith('.tgz')
        ? 'application/octet-stream'
        : 'application/json',
    };
  }

  return downloadImpl;
}
