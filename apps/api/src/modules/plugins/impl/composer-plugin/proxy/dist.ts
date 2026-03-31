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
  parseComposerDistRequest,
  type ComposerProxyFetchResult,
  type ComposerProxyOptions,
} from './helpers';

type StorageModule = {
  proxyDownload: (
    repo: Repository,
    url: string,
    packageName: string,
    version: string,
  ) => Promise<ComposerProxyFetchResult>;
};

function getComposerProxyDownload(context: PluginContext) {
  const { initStorage } = require('../storage/storage') as {
    initStorage: (ctx: PluginContext) => StorageModule;
  };

  return initStorage(context).proxyDownload;
}

function buildComposerDistResponse(
  result: ComposerProxyFetchResult,
): ComposerProxyFetchResult {
  const payload = result.body ?? result.data;
  if (!result.ok || payload === undefined) {
    return result;
  }

  return {
    ok: true,
    status: 200,
    body: payload,
    headers: {
      'content-type': result.contentType || 'application/zip',
      'x-proxy-cache': result.skipCache ? 'HIT' : 'MISS',
    },
  };
}

export async function handleComposerDistProxyFetch(
  context: PluginContext,
  repo: Repository,
  url: string,
  options?: ComposerProxyOptions,
): Promise<ComposerProxyFetchResult | null> {
  const proxyDownload = getComposerProxyDownload(context);
  const parsedRequest = parseComposerDistRequest(url);

  if (parsedRequest) {
    const result = await proxyDownload(
      repo,
      parsedRequest.targetUrl,
      parsedRequest.packageName,
      parsedRequest.version,
    );
    return buildComposerDistResponse(result);
  }

  if (!options?.packageName || !options.version) {
    return null;
  }

  return proxyDownload(repo, url, options.packageName, options.version);
}
