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
  getComposerUpstreamUrl,
  isComposerJsonRequest,
  toComposerBuffer,
  type ComposerProxyFetchResult,
} from './helpers';

type StorageLike = {
  get: (key: string) => Promise<Buffer | null>;
  save: (key: string, data: Buffer | string) => Promise<unknown>;
};

type ProcessMetadata = (
  repo: Repository,
  url: string,
  content: unknown,
  upstreamUrl: string,
) => Promise<string>;

export async function getComposerCachedResponse(
  storage: StorageLike | undefined,
  repo: Repository,
  url: string,
  key: string,
  processMetadata: ProcessMetadata,
): Promise<ComposerProxyFetchResult | null> {
  if (!storage) {
    return null;
  }

  const cached = await storage.get(key);
  if (!cached) {
    return null;
  }

  const isJson = isComposerJsonRequest(url);
  let bodyBuffer = cached;

  if (isJson) {
    try {
      const processed = await processMetadata(
        repo,
        url,
        cached,
        getComposerUpstreamUrl(repo),
      );
      bodyBuffer = Buffer.from(processed);
    } catch (error) {
      console.error(
        '[ComposerPlugin] Failed to process cached metadata:',
        error,
      );
    }
  }

  return {
    ok: true,
    body: isJson ? JSON.parse(bodyBuffer.toString()) : bodyBuffer,
    headers: {
      'content-type': isJson ? 'application/json' : 'application/octet-stream',
      'content-length': bodyBuffer.length.toString(),
      'x-proxy-cache': 'HIT',
    },
  };
}

export async function processComposerUpstreamResponse(
  storage: StorageLike | undefined,
  repo: Repository,
  url: string,
  key: string,
  response: ComposerProxyFetchResult,
  processMetadata: ProcessMetadata,
): Promise<ComposerProxyFetchResult> {
  if (!response.ok) {
    return response;
  }

  const contentType = response.headers?.['content-type'];
  const isJson = isComposerJsonRequest(url, contentType);
  const upstreamUrl = getComposerUpstreamUrl(repo);
  const responseContent = response.json ?? response.body;

  if (isJson && responseContent !== undefined && upstreamUrl) {
    try {
      const processed = await processMetadata(
        repo,
        url,
        responseContent,
        upstreamUrl,
      );
      const processedBuffer = Buffer.from(processed);

      if (storage) {
        await storage.save(key, toComposerBuffer(responseContent));
      }

      return {
        ...response,
        body: processed,
        headers: {
          ...response.headers,
          'content-length': processedBuffer.length.toString(),
          'x-proxy-cache': 'MISS',
        },
      };
    } catch (error) {
      console.error('[ComposerPlugin] Error processing metadata:', error);
      return response;
    }
  }

  if (storage && response.body !== undefined) {
    await storage.save(key, toComposerBuffer(response.body));
  }

  return response;
}
