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

import type { Repository } from '../utils/types';
import {
  buildNugetV2Feed,
  buildNugetV2ServiceDocument,
  buildNugetV3ServiceIndex,
} from './feed';
import {
  createPackageBaseResolver,
  extractNugetFeedPackageId,
  isNugetFeedMetadataRequest,
  rewriteNugetProxyFeedXml,
} from './download-feed-support';
import {
  getRepoBaseUrl,
  isNugetV3,
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

export async function createHostedOrGroupFeedResponse(
  repo: Repository,
  config: NugetConfig,
  pkgName: string,
  listFeedVersions: (repo: Repository, packageId: string) => Promise<string[]>,
): Promise<NugetDownloadResult | null> {
  const baseUrl = getRepoBaseUrl(repo.name);

  if (pkgName === 'index.json' && isNugetV3(config)) {
    return {
      ok: true,
      contentType: 'application/json',
      data: buildNugetV3ServiceIndex(baseUrl),
    };
  }

  if (isNugetV3(config)) {
    return null;
  }

  if (isNugetFeedMetadataRequest(pkgName)) {
    return {
      ok: true,
      contentType: 'application/xml',
      data: buildNugetV2ServiceDocument(baseUrl),
    };
  }

  if (
    !pkgName.startsWith('FindPackagesById') &&
    !pkgName.startsWith('Packages')
  ) {
    return null;
  }

  const packageId = extractNugetFeedPackageId(pkgName);

  console.log(`[NuGetPlugin] V2 feed query for package ID: ${packageId}`);

  const versions = await listFeedVersions(repo, packageId);
  console.log(
    `[NuGetPlugin] Found versions for ${packageId}: ${versions.join(', ')}`,
  );

  return {
    ok: true,
    contentType: 'application/xml',
    data: buildNugetV2Feed(baseUrl, packageId, versions),
  };
}

export async function createProxyV2FeedResponse(
  repo: Repository,
  config: NugetConfig,
  pkgName: string,
  proxyFetch?: ProxyFetch,
): Promise<NugetDownloadResult | null> {
  if (isNugetV3(config)) {
    return null;
  }

  const baseUrl = getRepoBaseUrl(repo.name);

  if (isNugetFeedMetadataRequest(pkgName)) {
    return {
      ok: true,
      contentType: 'application/xml',
      data: buildNugetV2ServiceDocument(baseUrl),
    };
  }

  if (
    !pkgName.startsWith('FindPackagesById') &&
    !pkgName.startsWith('Packages')
  ) {
    return null;
  }

  console.log(`[NuGetPlugin] Proxying V2 feed query for path: ${pkgName}`);

  if (!proxyFetch) {
    return { ok: false, message: 'Proxy not available' };
  }

  const response = await proxyFetch(repo, pkgName);
  if (response.status !== 200 || !response.body) {
    return { ok: false, message: 'Not found in upstream' };
  }

  return {
    ok: true,
    contentType: 'application/xml',
    data: rewriteNugetProxyFeedXml(
      repo.name,
      config.proxyUrl || '',
      response.body,
    ),
  };
}

export { createPackageBaseResolver };
