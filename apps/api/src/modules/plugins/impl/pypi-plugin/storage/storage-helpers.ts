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

export function getPyPiUploadBuffer(pkg: any): Buffer {
  const data = pkg?.content ?? JSON.stringify(pkg ?? {});
  if (pkg?.encoding === 'base64' && typeof data === 'string') {
    return Buffer.from(data, 'base64');
  }
  return Buffer.isBuffer(data) ? data : Buffer.from(String(data));
}

export async function readPyPiRequestBuffer(req: any): Promise<Buffer> {
  if (Buffer.isBuffer(req?.body)) {
    return req.body;
  }
  if (Buffer.isBuffer(req?.buffer)) {
    return req.buffer;
  }
  if (req?.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }
  if (req?.body !== undefined && req?.body !== null) {
    return Buffer.from(String(req.body));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function parsePyPiStoragePath(path: string) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 3) {
    return {
      name: parts[0],
      version: parts[1],
      filename: parts[2],
    };
  }
  if (parts.length === 2) {
    return {
      name: parts[0],
      version: parts[1],
      filename: 'package.tar.gz',
    };
  }
  if (parts.length === 1) {
    return {
      name: parts[0],
      version: '0.0.1',
      filename: 'package.tar.gz',
    };
  }
  return {
    name: 'pkg',
    version: '0.0.1',
    filename: 'package.tar.gz',
  };
}

export function getPyPiPackageKeys(
  repo: Repository,
  name: string,
  version: string,
  filename?: string,
) {
  const segments = filename
    ? ['pypi', repo.id, name, version, filename]
    : ['pypi', repo.id, name, version];
  const namedSegments = filename
    ? ['pypi', repo.name, name, version, filename]
    : ['pypi', repo.name, name, version];

  return {
    keyId: buildKey(...segments),
    keyName: buildKey(...namedSegments),
  };
}

export function buildPyPiRepoBaseUrl(repo: Repository): string {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  return `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
}

export function pickPreferredPyPiFile(keys: string[], directoryKey: string) {
  const files = keys.filter(
    (key) => key !== directoryKey && key !== `${directoryKey}/`,
  );
  return (
    files.find((key) => key.endsWith('.whl')) ||
    files.find((key) => key.endsWith('.tar.gz')) ||
    files[0] ||
    null
  );
}
