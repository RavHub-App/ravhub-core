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

import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import type { PluginContext, Repository } from '../utils/types';
import { getPyPiPackageKeys } from './storage-helpers';
import type { DownloadResult } from './download-support';

type ProxyDownloadResult = DownloadResult & {
  body?: Buffer | string;
};

export async function downloadProxyArtifact(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string,
): Promise<DownloadResult> {
  const upstreamUrl = repo.config?.proxyUrl || repo.config?.url;
  if (!upstreamUrl) {
    return { ok: false, message: 'Not found' };
  }

  const proxyKey = getPyPiPackageKeys(
    repo,
    'proxy',
    `${name}/${version}`,
  ).keyId;
  const targetUrl = `${String(upstreamUrl).replace(/\/$/, '')}/${name}/${version}`;

  return runWithLock(context, proxyKey, async () => {
    const cachedResult = await readProxyCache(
      context.storage,
      proxyKey,
      name,
      version,
    );
    if (cachedResult) {
      return cachedResult;
    }

    try {
      const result = (await proxyFetchWithAuth(
        repo,
        targetUrl,
      )) as ProxyDownloadResult;
      if (!(result.ok && result.body)) {
        return result;
      }

      const body = Buffer.isBuffer(result.body)
        ? result.body
        : Buffer.from(String(result.body));
      await context.storage.save(proxyKey, body);
      await indexProxyArtifact(context, repo, name, version, proxyKey, body);

      return { ...result, data: body, skipCache: true };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  });
}

async function readProxyCache(
  storage: PluginContext['storage'],
  proxyKey: string,
  name: string,
  version: string,
): Promise<DownloadResult | null> {
  try {
    const cached = await Promise.resolve(storage.get(proxyKey)).catch(
      () => null,
    );
    if (!cached) {
      return null;
    }

    return {
      ok: true,
      data: cached,
      contentType: 'application/octet-stream',
    };
  } catch (error) {
    console.warn(
      `[PyPIPlugin] Failed to read proxy cache for ${name}:${version}: ${String(error)}`,
    );
    return null;
  }
}

async function indexProxyArtifact(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string,
  proxyKey: string,
  body: Buffer,
) {
  if (!context.indexArtifact) {
    return;
  }

  try {
    await context.indexArtifact(repo, {
      ok: true,
      id: `${name}:${version}`,
      metadata: {
        name,
        version,
        storageKey: proxyKey,
        size: body.length,
      },
    });
  } catch (error) {
    console.warn(
      `[PyPIPlugin] Failed to index proxied artifact ${name}:${version}: ${String(error)}`,
    );
  }
}
