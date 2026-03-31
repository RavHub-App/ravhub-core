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
import {
  downloadFromGroup,
  downloadFromHostedStorage,
  downloadFromProxy,
  resolveNugetFeedDownload,
} from './download-helpers';
import { createPackageBaseResolver } from './download-feed';
import {
  createNugetVersionLister,
  normalizeNugetDownloadRequest,
} from './feed';
import type { NugetConfig, ProxyFetchResponse } from './storage-helpers';

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResponse>;

export type NugetDownloadResult = {
  ok: boolean;
  data?: Buffer;
  contentType?: string;
  message?: string;
};

export type NugetDownloadHandler = (
  repo: Repository,
  name: string,
  version?: string,
) => Promise<NugetDownloadResult>;

export function createNugetDownloader(
  context: PluginContext,
  proxyFetch?: ProxyFetch,
): {
  download: NugetDownloadHandler;
  getPackageBase: (repo: Repository) => Promise<string | null>;
} {
  const listFeedVersions = createNugetVersionLister(context);
  const getPackageBase = createPackageBaseResolver(proxyFetch);

  const handleDownload: NugetDownloadHandler = async (
    repo: Repository,
    name: string,
    version?: string,
  ) => {
    const config = (repo.config ?? {}) as NugetConfig;
    const { pkgName: normalizedName, pkgVersion: normalizedVersion } =
      normalizeNugetDownloadRequest(name, version);
    const packageName = normalizedName;
    const packageVersion = normalizedVersion;

    console.log(
      `[NuGetPlugin] Attempting to download package: ${packageName}:${packageVersion || 'latest'} from repo: ${repo.id}`,
    );

    const feedResponse = await resolveNugetFeedDownload(
      repo,
      config,
      packageName,
      listFeedVersions,
      proxyFetch,
    );
    if (feedResponse) {
      return feedResponse;
    }

    if (!packageVersion) {
      console.warn(
        `[NuGetPlugin] Download failed for ${packageName}: Version required but not found.`,
      );
      return { ok: false, message: 'Version required for download' };
    }

    const normalizedPackageName = packageName.toLowerCase();
    const normalizedPackageVersion = packageVersion.toLowerCase();

    if (repo.type === 'group') {
      return downloadFromGroup(
        context,
        config.members || [],
        handleDownload,
        normalizedPackageName,
        normalizedPackageVersion,
      );
    }

    if (repo.type === 'proxy') {
      return downloadFromProxy(
        context,
        context.storage,
        repo,
        normalizedPackageName,
        normalizedPackageVersion,
        getPackageBase,
        proxyFetch,
      );
    }

    return downloadFromHostedStorage(
      context.storage,
      repo,
      normalizedPackageName,
      normalizedPackageVersion,
    );
  };

  return { download: handleDownload, getPackageBase };
}
