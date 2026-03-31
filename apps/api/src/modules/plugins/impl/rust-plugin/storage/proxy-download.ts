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

import * as proxyHelperModule from '../../../../../plugins-core/proxy-helper';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';

type ProxyResponse = {
  ok?: boolean;
  message?: string;
  body?: Buffer | string;
  data?: Buffer;
  contentType?: string;
  skipCache?: boolean;
};

type ProxyHelper = (
  repo: Repository,
  url: string,
  options?: { method?: string; timeoutMs?: number },
) => Promise<ProxyResponse>;

function getProxyHelper(): ProxyHelper | null {
  try {
    const directCandidate = proxyHelperModule as unknown;
    const defaultCandidate = (proxyHelperModule as { default?: unknown })
      .default;
    const nestedDefaultCandidate =
      defaultCandidate && typeof defaultCandidate === 'object'
        ? (defaultCandidate as { default?: unknown }).default
        : undefined;

    if (typeof directCandidate === 'function') {
      return directCandidate as ProxyHelper;
    }
    if (typeof defaultCandidate === 'function') {
      return defaultCandidate as ProxyHelper;
    }
    if (typeof nestedDefaultCandidate === 'function') {
      return nestedDefaultCandidate as ProxyHelper;
    }

    throw new Error('proxy helper export is not callable');
  } catch (error) {
    console.warn(`[Rust] Proxy helper unavailable: ${String(error)}`);
    return null;
  }
}

export function createRustProxyDownloader(context: PluginContext) {
  const { storage } = context;

  return async (
    repo: Repository,
    url: string,
    name: string,
    version: string,
  ): Promise<ProxyResponse> => {
    const cleanVersion = version.split('?')[0].split('#')[0];
    const keyId = buildKey(
      'rust',
      repo.id,
      'proxy',
      name,
      cleanVersion,
      `${name}-${cleanVersion}.crate`,
    );
    const cacheEnabled = repo.config?.cacheEnabled !== false;

    return runWithLock(
      context,
      `rust:${repo.id}:${name}:${version}`,
      async () => {
        const existing = cacheEnabled
          ? await storage.get(keyId).catch(() => null)
          : null;
        if (existing) {
          return { ok: true, data: existing, skipCache: true };
        }

        const proxyHelper = getProxyHelper();
        if (!proxyHelper) {
          return { ok: false, message: 'Proxy helper missing' };
        }

        const response = await proxyHelper(repo, url);
        if (!response.ok) return response;

        const buf = Buffer.isBuffer(response.body)
          ? response.body
          : Buffer.from(response.body || '');

        if (
          buf.length > 0 &&
          cacheEnabled &&
          (repo.config?.cacheMaxAgeDays ?? 7) > 0
        ) {
          await storage.save(keyId, buf);
          if (context.indexArtifact) {
            try {
              await context.indexArtifact(repo, {
                ok: true,
                id: `${name}:${cleanVersion}`,
                metadata: {
                  name,
                  version: cleanVersion,
                  storageKey: keyId,
                  size: buf.length,
                },
              });
            } catch (error) {
              console.warn(
                `[Rust] Failed to index proxied crate ${name}:${cleanVersion}: ${String(error)}`,
              );
            }
          }
        }

        return { ok: true, data: buf, contentType: 'application/octet-stream' };
      },
    );
  };
}
