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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import { type HelmRepository } from './helpers';
import {
  downloadFromHelmGroup,
  downloadFromHelmProxy,
  downloadHostedHelmArtifact,
  loadHelmProxyHelper,
  type HelmDownloadResult,
} from './download-support';

export function createHelmDownloader(context: PluginContext) {
  const proxyFetchWithAuth = loadHelmProxyHelper();

  const downloadImpl = async (
    repo: HelmRepository,
    packageName: string,
    visited: Set<string>,
  ): Promise<HelmDownloadResult> => {
    if (!repo) {
      return { ok: false, message: 'Not found' };
    }

    if (repo.type === 'group') {
      return downloadFromHelmGroup(
        context,
        repo,
        packageName,
        downloadImpl,
        visited,
      );
    }

    if (repo.type === 'proxy') {
      if (!proxyFetchWithAuth) {
        return { ok: false, message: 'Proxy helper missing' };
      }

      return downloadFromHelmProxy(
        context,
        repo,
        packageName,
        proxyFetchWithAuth,
      );
    }

    return downloadHostedHelmArtifact(context, repo, packageName);
  };

  return (repo: HelmRepository, packageName: string) => {
    return downloadImpl(repo, packageName, new Set());
  };
}
