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

export type RawPackage = {
  name?: string;
  version?: string;
  content?: unknown;
};

export type RawStorageRequest = {
  body?: unknown;
  buffer?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
};

type SaveResult = {
  size?: number;
  contentHash?: string;
};

export type RawStorageResult = {
  ok: boolean;
  id?: string;
  message?: string;
  data?: Buffer;
  contentType?: string;
  metadata?: {
    name: string;
    version: string;
    storageKey: string;
    size?: number;
    contentHash?: string;
  };
};

export type RawWriteOperation = (
  repo: Repository,
  pkg: RawPackage,
) => Promise<RawStorageResult>;

export type RawPutOperation = (
  repo: Repository,
  path: string,
  req: RawStorageRequest,
) => Promise<RawStorageResult>;

type StorageLike = PluginContext['storage'];

export type RawGroupConfig = {
  writePolicy?: string;
  members?: string[];
  preferredWriter?: string;
};

export function getRawStorageKeys(repo: Repository, name: string) {
  return {
    keyById: buildKey('raw', repo.id, name),
    keyByName: buildKey('raw', repo.name, name),
  };
}

export function getRawPackageBuffer(pkg: RawPackage): Buffer {
  const rawContent = pkg.content ?? JSON.stringify(pkg ?? {});
  return Buffer.isBuffer(rawContent)
    ? rawContent
    : Buffer.from(String(rawContent));
}

export async function readRawRequestBuffer(
  req: RawStorageRequest,
): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (Buffer.isBuffer(req.buffer)) {
    return req.buffer;
  }

  if (typeof req.body === 'object' && req.body) {
    return Buffer.from(JSON.stringify(req.body));
  }

  if (req.body !== undefined && req.body !== null) {
    return Buffer.from(String(req.body));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

export async function hasRawRedeployConflict(
  storage: StorageLike,
  repo: Repository,
  name: string,
): Promise<boolean> {
  const { keyById, keyByName } = getRawStorageKeys(repo, name);
  const existingById = await storage.get(keyById).catch(() => null);
  if (existingById) {
    return true;
  }

  const existingByName = await storage.get(keyByName).catch(() => null);
  return !!existingByName;
}

export function buildRawUploadResult(
  name: string,
  version: string,
  storageKey: string,
  saveResult: SaveResult,
  fallbackSize?: number,
): RawStorageResult {
  return {
    ok: true,
    id: name,
    metadata: {
      name,
      version,
      storageKey,
      size: saveResult.size ?? fallbackSize,
      contentHash: saveResult.contentHash,
    },
  };
}

export async function indexRawArtifact(
  context: PluginContext,
  repo: Repository,
  result: RawStorageResult,
) {
  if (!context.indexArtifact) {
    return;
  }

  try {
    await context.indexArtifact(repo, result);
  } catch (error) {
    console.error('[RawPlugin] Failed to index artifact:', error);
  }
}
