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
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import {
  persistComposerProxyPackage,
  readComposerProxyCache,
  resolveComposerProxyHelper,
  type ProxyHelperResponse,
} from './proxy-download-support';

type ComposerProxyConfig = {
  cacheEnabled?: boolean;
  cacheMaxAgeDays?: number;
};

export function createComposerProxyDownloader(context: PluginContext) {
  const { storage } = context;

  return async (
    repo: Repository,
    url: string,
    name: string,
    version: string,
  ): Promise<ProxyHelperResponse> => {
    const proxyConfig = (repo.config ?? {}) as ComposerProxyConfig;
    const cleanVersion = version.split('?')[0].split('#')[0];
    const cacheEnabled = proxyConfig.cacheEnabled !== false;
    let storageVersion = cleanVersion;
    if (!storageVersion.endsWith('.zip')) {
      storageVersion += '.zip';
    }

    const keyId = buildKey('composer', repo.id, 'proxy', name, storageVersion);
    const proxyHelper = resolveComposerProxyHelper();
    const cacheReadResult = await readComposerProxyCache(
      storage,
      proxyHelper,
      repo,
      url,
      name,
      cleanVersion,
      keyId,
      cacheEnabled,
    );
    if (cacheReadResult.cached) {
      return cacheReadResult.cached;
    }

    if (!proxyHelper) {
      return { ok: false, message: 'Proxy helper missing' };
    }

    const lockKey = `composer:${repo.id}:${name}:${version}`;
    return runWithLock(context, lockKey, async () => {
      if (cacheEnabled && !cacheReadResult.skipCacheCheck) {
        const cached = await storage.get(keyId).catch(() => null);
        if (cached) {
          return { ok: true, data: cached, skipCache: true };
        }
      }

      const response = await proxyHelper(repo, url);
      if (response.ok && response.body) {
        await persistComposerProxyPackage(
          context,
          storage,
          repo,
          proxyConfig,
          keyId,
          name,
          version,
          response.body,
        );
        return { ...response, skipCache: true };
      }
      return response;
    });
  };
}
