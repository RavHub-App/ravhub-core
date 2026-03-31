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
import type { PluginContext, Repository } from '../utils/types';
import {
  rewriteRustConfigBody,
  toBuffer,
  type RustProxyHelper,
} from './fetch-helpers';

type ProxyDownloadResult = {
  ok?: boolean;
  message?: string;
  data?: Buffer;
  contentType?: string;
  skipCache?: boolean;
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
};

type ProxyDownload = (
  repo: Repository,
  url: string,
  name: string,
  version: string,
) => Promise<ProxyDownloadResult>;

type ProxyResponse = {
  ok?: boolean;
  message?: string;
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
};

type FetchOptions = Record<string, unknown> | undefined;

export async function handleRustMagicDownload(
  pathUrl: string,
  repo: Repository,
  proxyDownload: ProxyDownload,
) {
  if (!pathUrl.startsWith('dl/') && !pathUrl.startsWith('rust-proxy/dl/')) {
    return null;
  }

  const parts = pathUrl.replace(/^rust-proxy\//, '').split('/');
  if (parts.length < 4) {
    return null;
  }

  const encodedTemplate = parts[1];
  const crate = parts[2];
  const version = parts[3];
  const template = Buffer.from(encodedTemplate, 'base64').toString('utf-8');
  const targetUrl = buildMagicDownloadUrl(template, crate, version);
  return createDownloadResponse(
    await proxyDownload(repo, targetUrl, crate, version),
  );
}

export async function handleRustMagicApi(
  pathUrl: string,
  repo: Repository,
  options: FetchOptions,
  proxyFetchWithAuth: RustProxyHelper,
) {
  if (!pathUrl.startsWith('api/') && !pathUrl.startsWith('rust-proxy/api/')) {
    return null;
  }

  const parts = pathUrl.replace(/^rust-proxy\//, '').split('/');
  if (parts.length < 2 || parts[1].length <= 10) {
    return null;
  }

  const encodedBase = parts[1];
  const rest = parts.slice(2).join('/');
  const upstreamBase = Buffer.from(encodedBase, 'base64').toString('utf-8');
  const targetUrl = upstreamBase.endsWith('/')
    ? `${upstreamBase}${rest}`
    : `${upstreamBase}/${rest}`;

  return await proxyFetchWithAuth(repo, targetUrl, options);
}

export async function handleStandardRustDownload(
  upstreamRequestUrl: string,
  repo: Repository,
  proxyDownload: ProxyDownload,
) {
  const downloadMatch = upstreamRequestUrl.match(
    /^\/?api\/v1\/crates\/([^/]+)\/([^/]+)\/download$/,
  );
  if (!downloadMatch) {
    return null;
  }

  const crate = downloadMatch[1];
  const version = downloadMatch[2];
  const upstream = getConfiguredUpstream(repo);
  if (!upstream) {
    console.error('[RustPlugin] No proxyUrl configured');
    return { ok: false, message: 'No proxyUrl configured' };
  }

  const targetPath = upstreamRequestUrl.startsWith('/')
    ? upstreamRequestUrl.slice(1)
    : upstreamRequestUrl;
  return createDownloadResponse(
    await proxyDownload(repo, `${upstream}/${targetPath}`, crate, version),
  );
}

export async function handleDirectRustDownload(
  pathUrl: string,
  repo: Repository,
  proxyDownload: ProxyDownload,
) {
  const pathParts = pathUrl.split('/');
  if (pathParts.length !== 2) {
    return null;
  }

  const [crate, version] = pathParts;
  const upstream = getConfiguredUpstream(repo);
  if (!upstream) {
    return { ok: false, message: 'No proxyUrl configured' };
  }

  return createDownloadResponse(
    await proxyDownload(
      repo,
      `${upstream}/${crate}/${version}`,
      crate,
      version,
    ),
    false,
  );
}

export async function fetchRustCachedResource(
  context: PluginContext,
  repo: Repository,
  fileUrl: string,
  options: FetchOptions,
  proxyFetchWithAuth: RustProxyHelper,
): Promise<ProxyResponse> {
  const key = buildKey('rust', repo.id, 'proxy', fileUrl || 'root');
  const isConfigRequest = fileUrl.endsWith('config.json');
  const cachedResponse = await readRustProxyCache(
    context,
    repo,
    key,
    fileUrl,
    isConfigRequest,
  );
  if (cachedResponse) {
    return cachedResponse;
  }

  const result = await proxyFetchWithAuth(repo, fileUrl, options);
  if (!result.ok) {
    return result;
  }

  await saveRustProxyCache(context, key, result.body);
  if (!isConfigRequest) {
    return result;
  }

  return rewriteRustConfigResponse(repo, result);
}

function buildMagicDownloadUrl(
  template: string,
  crate: string,
  version: string,
) {
  if (template.includes('{crate}') || template.includes('{version}')) {
    return template.replace('{crate}', crate).replace('{version}', version);
  }

  return `${template.replace(/\/$/, '')}/${crate}/${version}/download`;
}

function getConfiguredUpstream(repo: Repository) {
  const upstream = repo.config?.proxyUrl || repo.config?.url;
  if (!upstream) {
    return null;
  }

  return upstream.endsWith('/') ? upstream.slice(0, -1) : upstream;
}

function createDownloadResponse(
  result: ProxyDownloadResult,
  includeHitMissHeader = true,
) {
  if (!(result.ok && result.data)) {
    return result;
  }

  return {
    ok: true,
    status: 200,
    body: result.data,
    headers: {
      'content-type': result.contentType || 'application/octet-stream',
      ...(includeHitMissHeader
        ? { 'x-proxy-cache': result.skipCache ? 'HIT' : 'MISS' }
        : {}),
    },
  };
}

async function readRustProxyCache(
  context: PluginContext,
  repo: Repository,
  key: string,
  fileUrl: string,
  isConfigRequest: boolean,
) {
  if (!context.storage) {
    return null;
  }

  const cached = await context.storage.get(key);
  if (!cached) {
    return null;
  }

  let body = cached;
  if (isConfigRequest) {
    try {
      body = rewriteRustConfigBody(repo, cached);
    } catch (error) {
      console.error('[RustPlugin] Failed to rewrite cached config.json', error);
    }
  }

  return {
    ok: true,
    status: 200,
    body,
    headers: {
      'content-type': fileUrl.endsWith('.json')
        ? 'application/json'
        : 'text/plain',
      'x-proxy-cache': 'HIT',
    },
  };
}

async function saveRustProxyCache(
  context: PluginContext,
  key: string,
  body: unknown,
) {
  if (!context.storage) {
    return;
  }

  try {
    const contentToCache = toBuffer(body);
    if (contentToCache) {
      await context.storage.save(key, contentToCache);
    }
  } catch (error) {
    console.error('[RustPlugin] Failed to cache index file', error);
  }
}

function rewriteRustConfigResponse(repo: Repository, result: ProxyResponse) {
  try {
    const rewrittenBody = rewriteRustConfigBody(repo, result.body);
    const rewrittenText = rewrittenBody.toString();
    return {
      ...result,
      body: rewrittenText,
      headers: {
        ...result.headers,
        'content-length': String(Buffer.byteLength(rewrittenText)),
      },
    };
  } catch (error) {
    console.error('[RustPlugin] Failed to rewrite config.json', error);
    return result;
  }
}
