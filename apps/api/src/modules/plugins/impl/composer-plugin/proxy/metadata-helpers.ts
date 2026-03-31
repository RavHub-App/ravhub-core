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

type ComposerPackageVersion = {
  version?: string;
  dist?: {
    url?: string;
  };
};

type ComposerPackages = Record<string, Record<string, ComposerPackageVersion>>;

type ComposerMetadata = {
  packages?: ComposerPackages;
  includes?: Record<string, unknown>;
  'provider-includes'?: Record<string, unknown>;
  'metadata-url'?: string;
  'providers-url'?: string;
  'list-url'?: string;
  'notify-batch'?: string;
  search?: string;
  [key: string]: unknown;
};

const COMPOSER_TOP_LEVEL_URL_FIELDS = [
  'metadata-url',
  'providers-url',
  'list-url',
  'notify-batch',
  'search',
] as const;

export function getComposerProxyUrl(repo: Repository): string {
  const host = process.env.API_HOST || 'localhost:3000';
  const protocol = process.env.API_PROTOCOL || 'http';
  return `${protocol}://${host}/repository/${encodeURIComponent(repo.name)}`;
}

export function resolveComposerUpstreamUrl(
  url: string,
  upstreamUrl: string,
): string {
  if (/^https?:\/\//.test(url)) {
    return url;
  }

  try {
    const normalizedUpstream = upstreamUrl.endsWith('/')
      ? upstreamUrl
      : `${upstreamUrl}/`;
    return new URL(url.replace(/^\//, ''), normalizedUpstream).toString();
  } catch {
    return url;
  }
}

export function rewriteComposerUrl(
  value: string,
  repoUrl: string,
  upstreamUrl: string,
): string {
  if (!value) {
    return value;
  }

  if (value.startsWith(upstreamUrl)) {
    return value.replace(upstreamUrl, repoUrl);
  }

  if (value.startsWith('http')) {
    return value;
  }

  if (value.startsWith('/')) {
    return `${repoUrl}${value}`;
  }

  return `${repoUrl}/${value}`;
}

export function parseComposerMetadataContent(
  content: unknown,
): ComposerMetadata {
  if (Buffer.isBuffer(content)) {
    return JSON.parse(content.toString('utf8')) as ComposerMetadata;
  }

  if (typeof content === 'string') {
    return JSON.parse(content) as ComposerMetadata;
  }

  return content as ComposerMetadata;
}

export function rewriteComposerTopLevelUrls(
  metadata: ComposerMetadata,
  repoUrl: string,
  upstreamUrl: string,
) {
  for (const field of COMPOSER_TOP_LEVEL_URL_FIELDS) {
    const value = metadata[field];
    if (typeof value !== 'string') {
      continue;
    }

    metadata[field] = rewriteComposerUrl(value, repoUrl, upstreamUrl);
  }
}

export function rewriteComposerPathMap(
  paths: Record<string, unknown> | undefined,
  repoUrl: string,
  upstreamUrl: string,
): Record<string, unknown> | undefined {
  if (!paths) {
    return paths;
  }

  const rewrittenPaths: Record<string, unknown> = {};
  for (const [path, hash] of Object.entries(paths)) {
    rewrittenPaths[rewriteComposerUrl(path, repoUrl, upstreamUrl)] = hash;
  }

  return rewrittenPaths;
}

function buildComposerDistProxyUrl(
  repoUrl: string,
  distUrl: string,
  packageName: string,
  version: string,
): string {
  return `${repoUrl}/dist/${Buffer.from(distUrl).toString('base64')}/${packageName}/${version}.zip`;
}

export function rewriteComposerPackageDists(
  repo: Repository,
  metadata: ComposerMetadata,
  repoUrl: string,
  upstreamMetadataUrl: string,
) {
  const retention = repo.config?.cacheMaxAgeDays ?? 7;
  if (retention <= 0 || !metadata.packages) {
    return;
  }

  for (const [packageName, versions] of Object.entries(metadata.packages)) {
    for (const [versionKey, pkg] of Object.entries(versions)) {
      const distUrl = pkg.dist?.url;
      if (!distUrl) {
        continue;
      }

      let resolvedDistUrl = distUrl;
      try {
        resolvedDistUrl = new URL(distUrl, upstreamMetadataUrl).toString();
      } catch {
        resolvedDistUrl = distUrl;
      }

      const resolvedVersion = pkg.version || versionKey;
      pkg.dist!.url = buildComposerDistProxyUrl(
        repoUrl,
        resolvedDistUrl,
        packageName,
        resolvedVersion,
      );
    }
  }
}

export function buildComposerMetadataTargetUrl(
  upstreamUrl: string,
  name: string,
): string {
  if (name === 'packages.json') {
    return `${upstreamUrl}/packages.json`;
  }

  const cleanName = name.startsWith('/') ? name.slice(1) : name;
  return `${upstreamUrl}/${cleanName}`;
}
