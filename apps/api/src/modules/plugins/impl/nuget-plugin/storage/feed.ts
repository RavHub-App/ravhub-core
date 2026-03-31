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
import type { NugetConfig } from './storage-helpers';

export function buildNugetV3ServiceIndex(baseUrl: string): Buffer {
  return Buffer.from(
    JSON.stringify(
      {
        version: '3.0.0',
        resources: [
          { '@id': `${baseUrl}/v3/query`, '@type': 'SearchQueryService' },
          {
            '@id': `${baseUrl}/v3/query`,
            '@type': 'SearchQueryService/3.0.0-beta',
          },
          {
            '@id': `${baseUrl}/v3/query`,
            '@type': 'SearchQueryService/3.0.0-rc',
          },
          {
            '@id': `${baseUrl}/v3/registrations/`,
            '@type': 'RegistrationsBaseUrl',
          },
          {
            '@id': `${baseUrl}/v3/registrations/`,
            '@type': 'RegistrationsBaseUrl/3.6.0',
          },
          {
            '@id': `${baseUrl}/v3/flatcontainer/`,
            '@type': 'PackageBaseAddress/3.0.0',
          },
          { '@id': `${baseUrl}/v2/package`, '@type': 'PackagePublish/2.0.0' },
        ],
      },
      null,
      2,
    ),
  );
}

export function buildNugetV2ServiceDocument(baseUrl: string): Buffer {
  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<service xml:base="${baseUrl}" xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <workspace>
    <atom:title>Default</atom:title>
    <collection href="Packages">
      <atom:title>Packages</atom:title>
    </collection>
  </workspace>
</service>`);
}

export function normalizeNugetDownloadRequest(
  name: string,
  version?: string,
): { pkgName: string; pkgVersion?: string } {
  let pkgName = name;
  let pkgVersion = version;

  if (pkgName.startsWith('v3/flatcontainer/')) {
    const flatParts = pkgName.split('/').filter(Boolean);
    if (flatParts.length >= 4) {
      pkgName = flatParts[2];
      pkgVersion = flatParts[3];
    }
  }

  if (pkgName.startsWith('package/')) {
    const pkgParts = pkgName.split('/').filter(Boolean);
    if (pkgParts.length >= 3) {
      pkgName = pkgParts[1];
      pkgVersion = pkgParts[2];
    }
  }

  if (!pkgVersion && pkgName.includes('/')) {
    const parts = pkgName.split('/').filter(Boolean);
    if (parts.length >= 2) {
      if (parts[parts.length - 1].toLowerCase().endsWith('.nupkg')) {
        if (parts.length >= 3) {
          pkgVersion = parts[parts.length - 2];
          pkgName = parts[parts.length - 3];
        }
      } else {
        pkgVersion = parts[parts.length - 1];
        pkgName = parts[parts.length - 2];
      }
    }
  }

  return { pkgName, pkgVersion };
}

export function buildNugetV2Feed(
  baseUrl: string,
  packageId: string,
  versions: string[],
): Buffer {
  const entries = versions
    .map((version) => {
      const downloadUrl = `${baseUrl}/package/${packageId}/${version}`;
      return `<entry>
    <id>${baseUrl}/Packages(Id='${packageId}',Version='${version}')</id>
    <category term="NuGetGallery.OData.V2FeedPackage" scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme" />
    <link rel="edit" title="V2FeedPackage" href="Packages(Id='${packageId}',Version='${version}')" />
    <link rel="self" title="V2FeedPackage" href="Packages(Id='${packageId}',Version='${version}')" />
    <title type="text">${packageId}</title>
    <content type="application/zip" src="${downloadUrl}" />
    <m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
        <d:Id>${packageId}</d:Id>
        <d:Version>${version}</d:Version>
        <d:NormalizedVersion>${version}</d:NormalizedVersion>
    </m:properties>
</entry>`;
    })
    .join('\n');

  return Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xml:base="${baseUrl}">
    <title type="text">Packages</title>
    <id>${baseUrl}/Packages</id>
    <updated>${new Date().toISOString()}</updated>
    ${entries}
</feed>`);
}

export function createNugetVersionLister(context: PluginContext) {
  const { storage } = context;

  return async function listFeedVersions(
    repo: Repository,
    packageId: string,
  ): Promise<string[]> {
    const uniqueVersions = new Set<string>();
    if (!packageId) {
      return [];
    }

    try {
      const reposToScan = await resolveNugetFeedRepositories(context, repo);

      for (const { repo: currentRepo, isProxy } of reposToScan) {
        const prefixes = isProxy
          ? [buildKey('nuget', currentRepo.id, 'proxy', packageId)]
          : [
              buildKey('nuget', currentRepo.id, packageId),
              buildKey('nuget', currentRepo.name, packageId),
            ];

        await collectNugetVersionsForPrefixes(
          storage,
          packageId,
          prefixes,
          uniqueVersions,
        );
      }
    } catch (error) {
      console.error(
        `[NuGetPlugin] Error listing versions for ${packageId}: ${String(error)}`,
      );
    }

    return Array.from(uniqueVersions);
  };
}

async function resolveNugetFeedRepositories(
  context: PluginContext,
  repo: Repository,
) {
  const reposToScan: Array<{ repo: Repository; isProxy: boolean }> = [];

  if (repo.type !== 'group') {
    reposToScan.push({ repo, isProxy: false });
    return reposToScan;
  }

  const config = (repo.config ?? {}) as NugetConfig;
  const members = config.members || [];
  if (!context.getRepo) {
    return reposToScan;
  }

  for (const memberId of members) {
    const member = (await context.getRepo(memberId)) as Repository | null;
    if (!member) {
      continue;
    }

    reposToScan.push({
      repo: member,
      isProxy: member.type === 'proxy',
    });
  }

  return reposToScan;
}

async function collectNugetVersionsForPrefixes(
  storage: PluginContext['storage'],
  packageId: string,
  prefixes: string[],
  uniqueVersions: Set<string>,
) {
  for (const prefix of prefixes) {
    try {
      const files = await storage.list(prefix);
      for (const file of files) {
        const candidate = extractNugetVersionCandidate(file, packageId);
        if (candidate) {
          uniqueVersions.add(candidate);
        }
      }
    } catch (error) {
      console.warn(
        `[NuGetPlugin] Failed to list versions under ${prefix}: ${String(error)}`,
      );
    }
  }
}

function extractNugetVersionCandidate(file: string, packageId: string) {
  const parts = file.split('/');
  const packageIndex = parts.indexOf(packageId);
  if (packageIndex === -1 || parts.length <= packageIndex + 1) {
    return null;
  }

  return parts[packageIndex + 1] || null;
}
