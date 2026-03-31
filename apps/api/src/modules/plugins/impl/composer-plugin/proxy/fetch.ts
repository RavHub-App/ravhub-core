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
import { initMetadata } from './metadata';
import {
  buildComposerProxyKey,
  type ComposerProxyFetchResult,
  type ComposerProxyOptions,
} from './helpers';
import {
  getComposerCachedResponse,
  processComposerUpstreamResponse,
} from './cache';
import { handleComposerDistProxyFetch } from './dist';

type ComposerProxyHelper = (
  repo: Repository,
  url: string,
) => Promise<ComposerProxyFetchResult>;

function loadComposerProxyHelper(): ComposerProxyHelper {
  try {
    return require('../../../../../plugins-core/proxy-helper')
      .default as ComposerProxyHelper;
  } catch (error) {
    console.error('[ComposerPlugin] Failed to load proxy-helper:', error);
    throw error;
  }
}

export function initProxy(context: PluginContext) {
  const { processMetadata } = initMetadata(context);

  const proxyFetch = async (
    repo: Repository,
    url: string,
    options?: ComposerProxyOptions,
  ) => {
    const key = buildComposerProxyKey(repo, url);

    const cachedResponse = await getComposerCachedResponse(
      context.storage,
      repo,
      url,
      key,
      processMetadata,
    );
    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const distResponse = await handleComposerDistProxyFetch(
        context,
        repo,
        url,
        options,
      );
      if (distResponse) {
        return distResponse;
      }
    } catch (error) {
      console.error('[ComposerPlugin] Failed to resolve dist download:', error);
    }

    try {
      const proxyFetchWithAuth = loadComposerProxyHelper();
      const response = await proxyFetchWithAuth(repo, url);
      return processComposerUpstreamResponse(
        context.storage,
        repo,
        url,
        key,
        response,
        processMetadata,
      );
    } catch (error: unknown) {
      return { ok: false, message: String(error) };
    }
  };

  return { proxyFetch };
}
