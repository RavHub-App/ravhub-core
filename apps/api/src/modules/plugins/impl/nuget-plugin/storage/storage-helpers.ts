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

export type NugetConfig = {
  writePolicy?:
    | 'none'
    | 'first'
    | 'preferred'
    | 'broadcast'
    | 'mirror'
    | string;
  preferredWriter?: string;
  members?: string[];
  allowRedeploy?: boolean;
  proxyUrl?: string;
  url?: string;
  nuget?: {
    version?: 'v2' | 'v3' | string;
    allowRedeploy?: boolean;
  };
};

export type NugetPackage = {
  name?: string;
  version?: string;
  content?: unknown;
  buffer?: unknown;
};

export type NugetStorageRequest = {
  body?: unknown;
  buffer?: unknown;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
} & AsyncIterable<Buffer>;

export type NugetUploadResult = {
  ok: boolean;
  id?: string;
  message?: string;
  metadata?: {
    name: string;
    version: string;
    storageKey: string;
    size?: number;
    contentHash?: string;
  };
};

export type ProxyFetchResponse = {
  ok?: boolean;
  status?: number;
  body?: Buffer | string | object;
  headers?: Record<string, string>;
  message?: string;
};

type EventedRequest = {
  on: (event: string, handler: (...args: unknown[]) => void) => void;
};

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function streamToBuffer(
  req: NugetStorageRequest,
): Promise<Buffer> {
  if (typeof req.on === 'function') {
    const eventedRequest = req as EventedRequest;
    const chunks: Buffer[] = [];
    return await new Promise((resolve, reject) => {
      eventedRequest.on('data', (chunk: unknown) => {
        chunks.push(
          Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
        );
      });
      eventedRequest.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      eventedRequest.on('error', (error: unknown) => {
        reject(toError(error));
      });
    });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function getNugetUploadBuffer(pkg: NugetPackage | Buffer): Buffer {
  if (Buffer.isBuffer(pkg)) return pkg;
  if (pkg.content) {
    return Buffer.isBuffer(pkg.content)
      ? pkg.content
      : Buffer.from(String(pkg.content));
  }
  if (pkg.buffer) {
    return Buffer.isBuffer(pkg.buffer)
      ? pkg.buffer
      : Buffer.from(String(pkg.buffer));
  }
  return Buffer.from(JSON.stringify(pkg));
}

export async function getRequestBodyBuffer(
  req: NugetStorageRequest,
): Promise<Buffer> {
  if (req.body && (Buffer.isBuffer(req.body) || String(req.body).length > 0)) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'object')
      return Buffer.from(JSON.stringify(req.body));
    return Buffer.from(String(req.body));
  }

  if (req.buffer) {
    return Buffer.isBuffer(req.buffer)
      ? req.buffer
      : Buffer.from(String(req.buffer));
  }

  return streamToBuffer(req);
}

export function parseNugetPath(path: string): {
  pkgName: string;
  pkgVersion: string;
} {
  const parts = path.split('/').filter(Boolean);
  let pkgName = 'unknown';
  let pkgVersion = '0.0.0';

  if (parts.length >= 2) {
    if (parts[parts.length - 1].toLowerCase().endsWith('.nupkg')) {
      if (parts.length >= 3) {
        pkgName = parts[parts.length - 3];
        pkgVersion = parts[parts.length - 2];
      } else {
        pkgName = parts[0];
        pkgVersion = parts[1];
      }
    } else {
      pkgName = parts[0];
      pkgVersion = parts[1];
    }
  }

  return {
    pkgName: pkgName.toLowerCase(),
    pkgVersion: pkgVersion.toLowerCase(),
  };
}

export function isNugetV3(config: NugetConfig): boolean {
  return (config.nuget?.version || 'v3') === 'v3';
}

export function allowNugetRedeploy(config: NugetConfig): boolean {
  return (
    config.nuget?.allowRedeploy !== false && config.allowRedeploy !== false
  );
}

export function getRepoBaseUrl(repoName: string): string {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  return `${proto}://${host}/repository/${encodeURIComponent(repoName)}`;
}

export function parseProxyBodyAsJson(
  body: ProxyFetchResponse['body'],
): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body);
  }
  if (Buffer.isBuffer(body)) {
    return JSON.parse(body.toString());
  }
  return body;
}

export function buildNugetProxyCacheKeys(
  repo: Repository,
  packageName: string,
  packageVersion: string,
) {
  const fileName = `${packageName}.${packageVersion}.nupkg`;

  return {
    fileName,
    proxyKey: buildKey(
      'nuget',
      repo.id,
      'proxy',
      packageName,
      packageVersion,
      fileName,
    ),
    legacyProxyKey: buildKey(
      'nuget',
      repo.id,
      'proxy',
      packageName,
      packageVersion,
    ),
  };
}

export function buildNugetHostedKeys(
  repo: Repository,
  packageName: string,
  packageVersion: string,
) {
  const fileName = `${packageName}.${packageVersion}.nupkg`;

  return {
    storageKeyById: buildKey(
      'nuget',
      repo.id,
      packageName,
      packageVersion,
      fileName,
    ),
    storageKeyByName: buildKey(
      'nuget',
      repo.name,
      packageName,
      packageVersion,
      fileName,
    ),
    legacyKeyById: buildKey('nuget', repo.id, packageName, packageVersion),
    legacyKeyByName: buildKey('nuget', repo.name, packageName, packageVersion),
  };
}

export async function readNugetProxyCache(
  storage: { get: (key: string) => Promise<Buffer | null> },
  proxyKey: string,
  legacyProxyKey: string,
) {
  let cached = await storage.get(proxyKey).catch(() => null);
  if (!cached) {
    cached = await storage.get(legacyProxyKey).catch(() => null);
  }

  return cached;
}

export async function readNugetHostedPackage(
  storage: { get: (key: string) => Promise<Buffer | null> },
  keys: {
    storageKeyById: string;
    storageKeyByName: string;
    legacyKeyById: string;
    legacyKeyByName: string;
  },
) {
  let data = await storage.get(keys.storageKeyById).catch(() => null);
  if (!data) {
    data = await storage.get(keys.storageKeyByName).catch(() => null);
  }
  if (!data) {
    data = await storage.get(keys.legacyKeyById).catch(() => null);
  }
  if (!data) {
    data = await storage.get(keys.legacyKeyByName).catch(() => null);
  }

  return data;
}
