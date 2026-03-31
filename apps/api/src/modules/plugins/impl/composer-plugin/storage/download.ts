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
import { buildHostedPackagesJson } from './packages-json';
import type { ComposerDownloadResult } from './write';
import {
  buildComposerProxyArtifactUrl,
  createComposerProxyMetadataDownloader,
  downloadFromComposerGroup,
  downloadHostedComposerArtifact,
  parseComposerArtifactCoordinates,
} from './download-support';

type ProxyDownload = (
  repo: Repository,
  url: string,
  packageName: string,
  version: string,
) => Promise<ComposerDownloadResult>;

export function createComposerDownloader(
  context: PluginContext,
  proxyDownload: ProxyDownload,
) {
  const downloadComposerMetadata =
    createComposerProxyMetadataDownloader(context);

  const download = async (
    repo: Repository,
    name: string,
    version?: string,
  ): Promise<ComposerDownloadResult> => {
    if (repo.type === 'group') {
      return downloadFromComposerGroup(context, repo, name, version, download);
    }

    if (repo.type === 'hosted' && name === 'packages.json') {
      return buildHostedPackagesJson(repo, context.storage);
    }

    if (repo.type === 'proxy') {
      if (
        name === 'packages.json' ||
        name.startsWith('p/') ||
        name.includes('.json')
      ) {
        return downloadComposerMetadata(repo, name);
      }

      const coordinates = parseComposerArtifactCoordinates(name, version);
      const targetUrl = buildComposerProxyArtifactUrl(repo, name);
      if (coordinates && targetUrl) {
        return proxyDownload(
          repo,
          targetUrl,
          coordinates.name,
          coordinates.version,
        );
      }
    }

    const coordinates = parseComposerArtifactCoordinates(name, version);
    if (!coordinates) {
      return { ok: false, message: 'Version required' };
    }

    return downloadHostedComposerArtifact(
      context,
      repo,
      coordinates.name,
      coordinates.version,
    );
  };

  return download;
}
