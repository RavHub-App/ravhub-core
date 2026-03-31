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
import { buildRustConfig } from './storage-helpers';

type DownloadResult = {
  ok?: boolean;
  message?: string;
  data?: Buffer;
  contentType?: string;
};

type ProxyDownload = (
  repo: Repository,
  url: string,
  name: string,
  version: string,
) => Promise<DownloadResult>;

export function createRustDownloader(
  context: PluginContext,
  proxyDownload: ProxyDownload,
) {
  const { storage } = context;

  return async (
    repo: Repository,
    name: string,
    version?: string,
  ): Promise<DownloadResult> => {
    const normalizedTarget = normalizeRustDownloadTarget(name, version);

    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      if (!context.getRepo) {
        return { ok: false, message: 'Context not ready' };
      }

      for (const id of members) {
        try {
          const member = (await context.getRepo(id)) as Repository | null;
          if (member) {
            const result = await createRustDownloader(context, proxyDownload)(
              member,
              normalizedTarget.name,
              normalizedTarget.version,
            );
            if (result.ok) return result;
          }
        } catch (error) {
          console.warn(
            `[Rust] Group download failed for member ${id}: ${String(error)}`,
          );
        }
      }

      return { ok: false, message: 'Not found in group' };
    }

    if (name === 'config.json') {
      return {
        ok: true,
        contentType: 'application/json',
        data: buildRustConfig(repo.name),
      };
    }

    if (!version && !name.endsWith('.crate') && name !== 'download') {
      const indexPath = name.startsWith('index/') ? name.substring(6) : name;
      const key = buildKey('rust', repo.id, 'index', indexPath);
      try {
        const data = await storage.get(key);
        if (data) return { ok: true, data, contentType: 'text/plain' };
      } catch (error) {
        console.warn(
          `[Rust] Failed to read index path ${indexPath}: ${String(error)}`,
        );
        return { ok: false, message: 'Not found' };
      }
    }

    if (repo.type === 'proxy') {
      const upstream = repo.config?.proxyUrl || repo.config?.url;
      if (!upstream) {
        return { ok: false, message: 'No upstream URL configured' };
      }

      if (!normalizedTarget.version) {
        return { ok: false, message: 'Version required' };
      }

      const cleanUpstream = upstream.endsWith('/')
        ? upstream.slice(0, -1)
        : upstream;
      return proxyDownload(
        repo,
        `${cleanUpstream}/${normalizedTarget.name}/${normalizedTarget.version}`,
        normalizedTarget.name,
        normalizedTarget.version,
      );
    }

    if (!version && name.includes('/')) {
      const parts = name.split('/');
      if (parts.length >= 2) {
        name = parts[0];
        version = parts[1];
      }
      if (parts[0] === 'crates' && parts.length >= 3) {
        name = parts[1];
        version = parts[2];
      }
    }

    if (!version) {
      return { ok: false, message: 'Version required' };
    }

    const fileName = `${name}-${version}.crate`;
    const keyId = buildKey('rust', repo.id, 'crates', name, version, fileName);
    try {
      let data = await storage.get(keyId).catch(() => null);
      if (!data) {
        data = await storage
          .get(buildKey('rust', repo.id, name, version, fileName))
          .catch(() => null);
      }
      if (!data) return { ok: false, message: 'Not found' };
      return { ok: true, data, contentType: 'application/octet-stream' };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };
}

function normalizeRustDownloadTarget(name: string, version?: string) {
  if (version || !name.includes('/')) {
    return { name, version };
  }

  const parts = name.split('/');
  if (parts[0] === 'crates' && parts.length >= 3) {
    return { name: parts[1], version: parts[2] };
  }

  if (parts.length === 2) {
    return { name: parts[0], version: parts[1] };
  }

  return { name, version };
}
