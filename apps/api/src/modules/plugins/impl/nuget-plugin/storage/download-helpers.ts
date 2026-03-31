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

import type { PluginContext, Repository } from '../utils/types';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import {
  createHostedOrGroupFeedResponse,
  createProxyV2FeedResponse,
} from './download-feed';
import {
  buildNugetHostedKeys,
  buildNugetProxyCacheKeys,
  readNugetHostedPackage,
  readNugetProxyCache,
  type NugetConfig,
  type ProxyFetchResponse,
} from './storage-helpers';

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResponse>;

type NugetDownloadResult = {
  ok: boolean;
  data?: Buffer;
  contentType?: string;
  message?: string;
};

type NugetDownloadHandler = (
  repo: Repository,
  name: string,
  version?: string,
) => Promise<NugetDownloadResult>;

type ListFeedVersions = (
  repo: Repository,
  packageId: string,
) => Promise<string[]>;

type StorageReader = {
  get: (key: string) => Promise<Buffer | null>;
  save: (key: string, data: Buffer) => Promise<unknown>;
};

export async function resolveNugetFeedDownload(
  repo: Repository,
  config: NugetConfig,
  packageName: string,
  listFeedVersions: ListFeedVersions,
  proxyFetch?: ProxyFetch,
): Promise<NugetDownloadResult | null> {
  if (repo.type === 'hosted' || repo.type === 'group') {
    const feedResponse = await createHostedOrGroupFeedResponse(
      repo,
      config,
      packageName,
      listFeedVersions,
    );
    if (feedResponse) {
      return feedResponse;
    }
  }

  if (repo.type === 'proxy') {
    const proxyFeedResponse = await createProxyV2FeedResponse(
      repo,
      config,
      packageName,
      proxyFetch,
    );
    if (proxyFeedResponse) {
      return proxyFeedResponse;
    }
  }

  return null;
}

export async function downloadFromGroup(
  context: PluginContext,
  members: string[],
  download: NugetDownloadHandler,
  packageName: string,
  packageVersion: string,
): Promise<NugetDownloadResult> {
  if (!context.getRepo) {
    return { ok: false, message: 'Context not ready' };
  }

  for (const memberId of members) {
    try {
      const member = (await context.getRepo(memberId)) as Repository | null;
      if (!member) {
        continue;
      }

      const result = await download(member, packageName, packageVersion);
      if (result.ok) {
        return result;
      }
    } catch (error) {
      console.warn(
        `[NuGetPlugin] Group download failed for member ${memberId}: ${String(error)}`,
      );
    }
  }

  return { ok: false, message: 'Not found in group' };
}

export async function downloadFromProxy(
  context: PluginContext,
  storage: StorageReader,
  repo: Repository,
  packageName: string,
  packageVersion: string,
  getPackageBase: (repo: Repository) => Promise<string | null>,
  proxyFetch?: ProxyFetch,
): Promise<NugetDownloadResult> {
  const { fileName, proxyKey, legacyProxyKey } = buildNugetProxyCacheKeys(
    repo,
    packageName,
    packageVersion,
  );

  try {
    const cached = await readNugetProxyCache(storage, proxyKey, legacyProxyKey);
    if (cached) {
      return {
        ok: true,
        data: cached,
        contentType: 'application/octet-stream',
      };
    }
  } catch (error) {
    console.warn(
      `[NuGetPlugin] Failed to read proxy cache for ${packageName}@${packageVersion}: ${String(error)}`,
    );
  }

  if (!proxyFetch) {
    return { ok: false, message: 'Proxy not available' };
  }

  return runWithLock(
    context,
    `nuget:${repo.id}:${packageName}:${packageVersion}`,
    async () => {
      const cached = await readNugetProxyCache(
        storage,
        proxyKey,
        legacyProxyKey,
      );
      if (cached) {
        return {
          ok: true,
          data: cached,
          contentType: 'application/octet-stream',
        };
      }

      const packageBase = await getPackageBase(repo);
      const upstreamPath = packageBase
        ? `${packageBase}${packageName}/${packageVersion}/${fileName}`
        : `${packageName}/${packageVersion}/${fileName}`;
      const response = await proxyFetch(repo, upstreamPath);

      if (response.status !== 200 || !response.body) {
        return { ok: false, message: 'Not found in upstream' };
      }

      const responseBody = response.body as Buffer;
      try {
        await storage.save(
          responseBody ? proxyKey : legacyProxyKey,
          responseBody,
        );
      } catch (error) {
        console.warn(
          `[NuGetPlugin] Failed to persist proxy cache for ${packageName}@${packageVersion}: ${String(error)}`,
        );
      }

      return {
        ok: true,
        data: responseBody,
        contentType: 'application/octet-stream',
      };
    },
  );
}

export async function downloadFromHostedStorage(
  storage: StorageReader,
  repo: Repository,
  packageName: string,
  packageVersion: string,
): Promise<NugetDownloadResult> {
  const keys = buildNugetHostedKeys(repo, packageName, packageVersion);

  try {
    const data = await readNugetHostedPackage(storage, keys);

    if (!data) {
      return { ok: false, message: 'Not found' };
    }

    return {
      ok: true,
      data,
      contentType: 'application/octet-stream',
    };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
