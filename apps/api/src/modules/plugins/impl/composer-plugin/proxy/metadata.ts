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

import { PluginContext, Repository } from '../utils/types';

type ComposerMetadataRecord = Record<string, unknown> & {
  includes?: Record<string, unknown>;
  'provider-includes'?: Record<string, unknown>;
};

const metadataHelpers = require('./metadata-helpers') as {
  buildComposerMetadataTargetUrl: (upstreamUrl: string, name: string) => string;
  getComposerProxyUrl: (repo: Repository) => string;
  parseComposerMetadataContent: (content: unknown) => ComposerMetadataRecord;
  resolveComposerUpstreamUrl: (url: string, upstreamUrl: string) => string;
  rewriteComposerPackageDists: (
    repo: Repository,
    metadata: ComposerMetadataRecord,
    repoUrl: string,
    upstreamMetadataUrl: string,
  ) => void;
  rewriteComposerPathMap: (
    paths: Record<string, unknown> | undefined,
    repoUrl: string,
    upstreamUrl: string,
  ) => Record<string, unknown> | undefined;
  rewriteComposerTopLevelUrls: (
    metadata: ComposerMetadataRecord,
    repoUrl: string,
    upstreamUrl: string,
  ) => void;
};

type ComposerProxyMetadataResult = {
  ok?: boolean;
  body?: unknown;
  data?: unknown;
  headers?: Record<string, string>;
  contentType?: string;
  message?: string;
};

type ComposerProxyHelper = (
  repo: Repository,
  url: string,
) => Promise<ComposerProxyMetadataResult>;

function loadComposerProxyHelper(): ComposerProxyHelper {
  const proxyHelperModule =
    require('../../../../../plugins-core/proxy-helper') as {
      default: ComposerProxyHelper;
    };
  return proxyHelperModule.default;
}

function getComposerConfiguredUpstream(repo: Repository): string {
  const upstreamUrl = repo.config?.proxyUrl;
  if (!upstreamUrl) {
    return '';
  }

  return upstreamUrl.endsWith('/') ? upstreamUrl.slice(0, -1) : upstreamUrl;
}

export function initMetadata(_context: PluginContext) {
  const processMetadata = async (
    repo: Repository,
    url: string,
    content: unknown,
    upstreamUrl: string,
  ) => {
    const repoUrl = metadataHelpers.getComposerProxyUrl(repo);
    const metadata = metadataHelpers.parseComposerMetadataContent(content);
    const upstreamMetadataUrl = metadataHelpers.resolveComposerUpstreamUrl(
      url,
      upstreamUrl,
    );

    metadataHelpers.rewriteComposerTopLevelUrls(metadata, repoUrl, upstreamUrl);
    metadata.includes = metadataHelpers.rewriteComposerPathMap(
      metadata.includes,
      repoUrl,
      upstreamUrl,
    );
    metadata['provider-includes'] = metadataHelpers.rewriteComposerPathMap(
      metadata['provider-includes'],
      repoUrl,
      upstreamUrl,
    );
    metadataHelpers.rewriteComposerPackageDists(
      repo,
      metadata,
      repoUrl,
      upstreamMetadataUrl,
    );

    return JSON.stringify(metadata);
  };

  const proxyMetadata = async (repo: Repository, name: string) => {
    const upstreamUrl = getComposerConfiguredUpstream(repo);
    if (!upstreamUrl) {
      return { ok: false, message: 'No proxy URL configured' };
    }

    const targetUrl = metadataHelpers.buildComposerMetadataTargetUrl(
      upstreamUrl,
      name,
    );

    try {
      const proxyFetchWithAuth = loadComposerProxyHelper();
      const result = await proxyFetchWithAuth(repo, targetUrl);
      if (!result.ok) {
        return result;
      }

      if (name.endsWith('.json') && result.body) {
        const processed = await processMetadata(
          repo,
          name,
          result.body,
          upstreamUrl,
        );
        return {
          ok: true,
          data: processed,
          contentType: 'application/json',
        };
      }

      return {
        ok: true,
        data: result.body,
        contentType:
          result.headers?.['content-type'] || 'application/octet-stream',
      };
    } catch (error: unknown) {
      return { ok: false, message: String(error) };
    }
  };

  return { proxyMetadata, processMetadata };
}
