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
import type {
  ComposerDownloadResult,
  ComposerPackage,
  StorageRequest,
} from './write';

type SaveResult = {
  size?: number;
  contentHash?: string;
};

type StorageLike = PluginContext['storage'];

export async function indexComposerArtifact(
  context: PluginContext,
  repo: Repository,
  result: ComposerDownloadResult,
) {
  if (!context.indexArtifact) {
    return;
  }

  try {
    await context.indexArtifact(repo, result);
  } catch (error) {
    console.error('[Composer] Failed to index artifact:', error);
  }
}

export async function hasComposerRedeployConflict(
  storage: StorageLike,
  repo: Repository,
  name: string,
  storageVersion: string,
) {
  const keyId = buildKey('composer', repo.id, name, storageVersion);
  const keyName = buildKey('composer', repo.name, name, storageVersion);

  return (
    (await storage.get(keyId).catch(() => null)) ||
    (await storage.get(keyName).catch(() => null))
  );
}

export function buildComposerUploadResult(
  name: string,
  version: string,
  storageKey: string,
  saveResult: SaveResult,
  fallbackSize?: number,
): ComposerDownloadResult {
  return {
    ok: true,
    id: `${name}:${version}`,
    metadata: {
      name,
      version,
      storageKey,
      size: saveResult.size ?? fallbackSize,
      contentHash: saveResult.contentHash,
    },
  };
}

export async function uploadComposerStream(
  context: PluginContext,
  repo: Repository,
  path: string,
  req: StorageRequest,
): Promise<ComposerDownloadResult> {
  const { name, version, storageKey } = parseComposerStreamPath(repo, path);

  try {
    const saveResult = (await context.storage.saveStream!(
      storageKey,
      req,
    )) as SaveResult;
    const result = buildComposerUploadResult(
      name,
      version,
      storageKey,
      saveResult,
    );
    await indexComposerArtifact(context, repo, result);
    return result;
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export function canStreamComposerUpload(
  storage: StorageLike,
  path: string,
  req: StorageRequest,
): boolean {
  return (
    path.endsWith('.zip') &&
    typeof storage.saveStream === 'function' &&
    !req.body &&
    !req.buffer
  );
}

export function parseComposerPackageBody(buffer: Buffer): ComposerPackage {
  const bodyText = buffer.toString().trim();
  if (!bodyText.startsWith('{') && !bodyText.startsWith('[')) {
    return { content: buffer };
  }

  try {
    const json = JSON.parse(bodyText) as ComposerPackage;
    if (typeof json.name !== 'string') {
      return { content: buffer };
    }

    return { ...json, content: buffer };
  } catch (error) {
    console.warn(
      `[Composer] Failed to parse package body as JSON: ${String(error)}`,
    );
    return { content: buffer };
  }
}

function parseComposerStreamPath(repo: Repository, path: string) {
  const parts = path.split('/').filter((part) => part);
  let name = 'vendor/package';
  let version = '0.0.1';

  if (parts.length >= 3) {
    name = `${parts[0]}/${parts[1]}`;
    version = parts[2].replace('.zip', '');
  }

  return {
    name,
    version,
    storageKey: buildKey('composer', repo.id, name, parts[parts.length - 1]),
  };
}
