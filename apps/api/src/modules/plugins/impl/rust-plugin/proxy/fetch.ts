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
import { initStorage } from '../storage/storage';
import { getRustProxyHelper, normalizeRustProxyUrl } from './fetch-helpers';
import {
  fetchRustCachedResource,
  handleDirectRustDownload,
  handleRustMagicApi,
  handleRustMagicDownload,
  handleStandardRustDownload,
} from './fetch-support';

export function initProxy(context: PluginContext) {
  const { proxyDownload } = initStorage(context);

  const proxyFetch = async (
    repo: Repository,
    url: string,
    options?: Record<string, unknown>,
  ) => {
    try {
      const proxyFetchWithAuth = getRustProxyHelper();
      if (!proxyFetchWithAuth) {
        return { ok: false, message: 'Proxy helper missing' };
      }

      const { upstreamRequestUrl, pathUrl } = normalizeRustProxyUrl(url);

      const magicDownloadResult = await handleRustMagicDownload(
        pathUrl,
        repo,
        proxyDownload,
      );
      if (magicDownloadResult) {
        return magicDownloadResult;
      }

      const magicApiResult = await handleRustMagicApi(
        pathUrl,
        repo,
        options,
        proxyFetchWithAuth,
      );
      if (magicApiResult) {
        return magicApiResult;
      }

      const standardDownloadResult = await handleStandardRustDownload(
        upstreamRequestUrl,
        repo,
        proxyDownload,
      );
      if (standardDownloadResult) {
        return standardDownloadResult;
      }

      const directDownloadResult = await handleDirectRustDownload(
        pathUrl,
        repo,
        proxyDownload,
      );
      if (directDownloadResult) {
        return directDownloadResult;
      }

      return await fetchRustCachedResource(
        context,
        repo,
        upstreamRequestUrl,
        options,
        proxyFetchWithAuth,
      );
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };

  return { proxyFetch };
}
