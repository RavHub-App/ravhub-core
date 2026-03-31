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
import type { Repository } from '../utils/types';
import { type ListVersionsResult, type ProxyFetchResult } from './helpers';
import {
  aggregateDockerGroupVersions,
  collectDockerManifestVersions,
  fetchDockerProxyVersionsFromUpstream,
} from './list-versions-support';

type ListVersionsDependencies = {
  storage: {
    list: (prefix: string) => Promise<string[]>;
    get: (key: string) => Promise<Buffer | null>;
  };
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
  proxyFetch?: (
    repo: Repository,
    path: string,
  ) => Promise<ProxyFetchResult | undefined>;
};

export function createListVersions({
  storage,
  getRepo,
  proxyFetch,
}: ListVersionsDependencies) {
  const listVersions = async (
    repo: Repository,
    name: string,
  ): Promise<ListVersionsResult> => {
    try {
      const versions = new Set<string>();

      if ((repo?.type || '').toString().toLowerCase() === 'group') {
        return aggregateDockerGroupVersions(repo, name, versions, {
          getRepo,
          listVersions,
        });
      }

      await collectDockerManifestVersions(storage, repo, name, versions);

      if (
        versions.size === 0 &&
        (repo?.type || '').toString().toLowerCase() === 'proxy' &&
        proxyFetch
      ) {
        await fetchDockerProxyVersionsFromUpstream(
          proxyFetch,
          repo,
          name,
          versions,
        );
      }

      return { ok: true, versions: Array.from(versions) };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };

  return listVersions;
}
