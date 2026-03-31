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

type ServiceIndexProcessor = (
  repo: Repository,
  body: Buffer | string,
) => unknown;

export type NugetProxyRequest = {
  targetUrl: string;
  cleanUrl: string;
  isNupkg: boolean;
  isMetadata: boolean;
};

export function derivePackageIdentity(cleanUrl: string) {
  try {
    const parts = cleanUrl.split('/').filter(Boolean);
    if (parts.length >= 3) {
      const name = parts[parts.length - 3];
      const version = parts[parts.length - 2];
      const filename = parts[parts.length - 1] || '';
      if (filename.toLowerCase() === `${name}.${version}.nupkg`.toLowerCase()) {
        return { name, version, filename };
      }
    }

    const filename = cleanUrl.split('/').pop() || '';
    const withoutExtension = filename.replace(/\.nupkg$/i, '');
    const segments = withoutExtension.split('.').filter(Boolean);
    for (let index = 1; index < segments.length; index += 1) {
      const name = segments.slice(0, index).join('.');
      const version = segments.slice(index).join('.');
      if (name && /^\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.-]+)?$/i.test(version)) {
        return { name, version, filename };
      }
    }
  } catch (error) {
    console.warn('[NUGET_PROXY] Failed to derive package identity:', error);
  }

  return null;
}

export function resolveNugetProxyRequest(
  repo: Repository,
  url: string,
): NugetProxyRequest {
  const targetUrl = url.startsWith('v3-proxy/')
    ? resolveMagicProxyUrl(url)
    : resolveStandardProxyUrl(repo, url);
  const cleanUrl = targetUrl.split('?')[0].split('#')[0];

  return {
    targetUrl,
    cleanUrl,
    isNupkg: cleanUrl.toLowerCase().endsWith('.nupkg'),
    isMetadata: cleanUrl.toLowerCase().endsWith('.json'),
  };
}

export function getCanonicalCacheKey(repo: Repository, cleanUrl: string) {
  const identity = derivePackageIdentity(cleanUrl);
  if (!identity) {
    return null;
  }

  return buildKey(
    'nuget',
    repo.id,
    'proxy',
    identity.name,
    identity.version,
    identity.filename,
  );
}

export function getProxyCacheKey(repo: Repository, cleanUrl: string) {
  return buildKey('nuget', repo.id, 'proxy', cleanUrl);
}

export function rewriteServiceIndexIfNeeded(
  processServiceIndex: ServiceIndexProcessor,
  repo: Repository,
  cleanUrl: string,
  body: Buffer,
) {
  if (cleanUrl.endsWith('index.json')) {
    return processServiceIndex(repo, body);
  }

  return body;
}

function resolveMagicProxyUrl(url: string) {
  if (url.match(/^v3-proxy\/https?:\/\//)) {
    return normalizeDecodedMagicUrl(url.replace(/^v3-proxy\//, ''));
  }

  const pathParts = url.split('/');
  const encodedBase = pathParts[1];
  const rest = pathParts.slice(2).join('/');
  if (!encodedBase) {
    return url;
  }

  const upstreamBase = decodeURIComponent(encodedBase);
  return upstreamBase.endsWith('/')
    ? `${upstreamBase}${rest}`
    : `${upstreamBase}/${rest}`;
}

function normalizeDecodedMagicUrl(targetUrl: string) {
  const [proto, rest] = targetUrl.split('://');
  if (!rest) {
    return targetUrl;
  }

  return `${proto}://${rest.replace(/\/\//g, '/')}`;
}

function resolveStandardProxyUrl(repo: Repository, url: string) {
  const proxyUrl = repo.config?.proxyUrl || '';
  if (url.match(/^https?:\/\//)) {
    return url;
  }

  if (url === 'index.json' && proxyUrl.endsWith('index.json')) {
    return proxyUrl;
  }

  return `${resolveBaseProxyUrl(proxyUrl, url).replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

function resolveBaseProxyUrl(proxyUrl: string, url: string) {
  const cleanUrl = url.split('?')[0].split('#')[0];
  const isNupkg = cleanUrl.toLowerCase().endsWith('.nupkg');
  if (isNupkg && proxyUrl.includes('api.nuget.org/v3/index.json')) {
    return 'https://api.nuget.org/v3-flatcontainer/';
  }

  if (proxyUrl.endsWith('.json')) {
    return proxyUrl.substring(0, proxyUrl.lastIndexOf('/'));
  }

  return proxyUrl;
}
