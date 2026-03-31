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

export type ComposerProxyFetchResult = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  data?: unknown;
  json?: unknown;
  headers?: Record<string, string>;
  contentType?: string;
  skipCache?: boolean;
  message?: string;
};

export type ComposerProxyOptions = {
  packageName?: string;
  version?: string;
};

export function normalizeComposerProxyUrl(url: string): string {
  return url.split('?')[0].split('#')[0];
}

export function buildComposerProxyKey(repo: Repository, url: string): string {
  return buildKey('composer', repo.id, 'proxy', normalizeComposerProxyUrl(url));
}

export function getComposerUpstreamUrl(repo: Repository): string {
  const proxyUrl = repo.config?.proxyUrl;
  if (typeof proxyUrl !== 'string' || proxyUrl.length === 0) {
    return '';
  }

  return proxyUrl.endsWith('/') ? proxyUrl.slice(0, -1) : proxyUrl;
}

export function isComposerJsonRequest(
  url: string,
  contentType?: string,
): boolean {
  return (
    normalizeComposerProxyUrl(url).endsWith('.json') ||
    (contentType ?? '').includes('application/json')
  );
}

export function toComposerBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }

  if (typeof value === 'string') {
    return Buffer.from(value);
  }

  return Buffer.from(JSON.stringify(value));
}

export function parseComposerDistRequest(url: string): {
  targetUrl: string;
  packageName: string;
  version: string;
} | null {
  if (!url.startsWith('dist/')) {
    return null;
  }

  const parts = url.split('/');
  if (parts.length < 5) {
    return null;
  }

  const targetUrl = Buffer.from(parts[1], 'base64').toString('utf8');
  const packageName = `${parts[2]}/${parts[3]}`;
  const version = parts[4].replace('.zip', '');

  return { targetUrl, packageName, version };
}
