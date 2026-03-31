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

import * as proxyHelperModule from '../../../../../plugins-core/proxy-helper';
import type { Repository } from '../utils/types';

type ProxyFetchResponse = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  message?: string;
};

export type RustProxyHelper = (
  repo: Repository,
  url: string,
  options?: unknown,
) => Promise<ProxyFetchResponse>;

export function getRustProxyHelper(): RustProxyHelper | null {
  try {
    const directCandidate = proxyHelperModule as unknown;
    const defaultCandidate = (proxyHelperModule as { default?: unknown })
      .default;
    const nestedDefaultCandidate =
      defaultCandidate && typeof defaultCandidate === 'object'
        ? (defaultCandidate as { default?: unknown }).default
        : undefined;

    if (typeof directCandidate === 'function') {
      return directCandidate as RustProxyHelper;
    }
    if (typeof defaultCandidate === 'function') {
      return defaultCandidate as RustProxyHelper;
    }
    if (typeof nestedDefaultCandidate === 'function') {
      return nestedDefaultCandidate as RustProxyHelper;
    }

    throw new Error('proxy helper export is not callable');
  } catch (error) {
    console.warn(`[RustPlugin] Proxy helper unavailable: ${String(error)}`);
    return null;
  }
}

export function getRustProxyBaseUrl(repo: Repository): string {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  return `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
}

export function normalizeRustProxyUrl(url: string): {
  upstreamRequestUrl: string;
  pathUrl: string;
} {
  let upstreamRequestUrl = url.split('?')[0].split('#')[0];
  let normalizedPathUrl = upstreamRequestUrl.startsWith('/')
    ? upstreamRequestUrl.slice(1)
    : upstreamRequestUrl;

  if (upstreamRequestUrl.startsWith('http')) {
    try {
      const parsedUrl = new URL(upstreamRequestUrl);
      let normalizedPath = parsedUrl.pathname;

      if (normalizedPath.startsWith('/repository/')) {
        const parts = normalizedPath.split('/').filter(Boolean);
        if (parts.length >= 2) {
          normalizedPath = parts.slice(2).join('/');
          upstreamRequestUrl = normalizedPath;
        }
      }

      normalizedPathUrl = normalizedPath.startsWith('/')
        ? normalizedPath.slice(1)
        : normalizedPath;
    } catch (error) {
      console.warn(
        `[RustPlugin] Failed to normalize proxy URL ${upstreamRequestUrl}: ${String(error)}`,
      );
    }
  }

  return {
    upstreamRequestUrl,
    pathUrl: normalizedPathUrl,
  };
}

export function toBuffer(body: unknown): Buffer | null {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body);
  if (typeof body === 'object' && body !== null) {
    return Buffer.from(JSON.stringify(body));
  }
  return null;
}

export function rewriteRustConfigBody(repo: Repository, body: unknown): Buffer {
  const json =
    typeof body === 'string'
      ? JSON.parse(body)
      : Buffer.isBuffer(body)
        ? JSON.parse(body.toString())
        : body;

  const baseUrl = getRustProxyBaseUrl(repo);

  if (
    json &&
    typeof json === 'object' &&
    'dl' in json &&
    typeof json.dl === 'string'
  ) {
    const encodedDl = Buffer.from(json.dl).toString('base64');
    json.dl = `${baseUrl}/rust-proxy/dl/${encodedDl}/{crate}/{version}`;
  }

  if (
    json &&
    typeof json === 'object' &&
    'api' in json &&
    typeof json.api === 'string'
  ) {
    const encodedApi = Buffer.from(json.api).toString('base64');
    json.api = `${baseUrl}/rust-proxy/api/${encodedApi}`;
  }

  return Buffer.from(JSON.stringify(json));
}
