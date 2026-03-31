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

import { initProxy } from '../proxy/fetch';
import { normalizeRepoPath } from '../utils/maven';
import { PluginContext, Repository } from '../utils/types';
import {
  createMavenRepoResolver,
  downloadFromMavenGroup,
  downloadFromMavenProxy,
  downloadHostedMavenArtifact,
  type DownloadResult,
} from './download-support';

export function createMavenDownloader(context: PluginContext) {
  const { storage } = context;
  const { proxyFetch } = initProxy(context);
  const resolveRepo = createMavenRepoResolver(context);

  async function downloadImpl(
    repo: Repository,
    repoPath: string,
    visited: Set<string>,
  ): Promise<DownloadResult> {
    if (!repo) return { ok: false, message: 'Not found' };

    const normalizedPath = normalizeRepoPath(repoPath);

    if (repo.type === 'group') {
      return downloadFromMavenGroup(
        repo,
        normalizedPath,
        visited,
        resolveRepo,
        downloadImpl,
      );
    }

    if (repo.type === 'proxy') {
      return downloadFromMavenProxy(
        context,
        storage,
        repo,
        normalizedPath,
        proxyFetch as (
          repo: Repository,
          path: string,
        ) => Promise<DownloadResult>,
      );
    }

    return downloadHostedMavenArtifact(storage, repo, normalizedPath);
  }

  return async (repo: Repository, name: string): Promise<DownloadResult> => {
    return downloadImpl(repo, name, new Set());
  };
}
