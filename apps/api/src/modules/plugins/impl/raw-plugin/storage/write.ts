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

import type { PluginContext, Repository } from '../utils/types';
import { handleRawGroupPut, handleRawGroupUpload } from './group-write';
import {
  buildRawUploadResult,
  getRawPackageBuffer,
  getRawStorageKeys,
  hasRawRedeployConflict,
  indexRawArtifact,
  readRawRequestBuffer,
  type RawPackage,
  type RawStorageRequest,
  type RawStorageResult,
} from './helpers';

type SaveResult = {
  size?: number;
  contentHash?: string;
};

function isRedeployAllowed(repo: Repository): boolean {
  return repo.config?.allowRedeploy !== false;
}

function canUseStreamUpload(
  context: PluginContext,
  req: RawStorageRequest,
): boolean {
  return (
    typeof context.storage.saveStream === 'function' &&
    req.body === undefined &&
    req.buffer === undefined
  );
}

async function createHostedRawUpload(
  context: PluginContext,
  repo: Repository,
  pkg: RawPackage,
): Promise<RawStorageResult> {
  const name = pkg.name || 'file.txt';
  const version = pkg.version || 'latest';
  const { keyById } = getRawStorageKeys(repo, name);

  if (!isRedeployAllowed(repo)) {
    const hasConflict = await hasRawRedeployConflict(
      context.storage,
      repo,
      name,
    );
    if (hasConflict) {
      return {
        ok: false,
        message: `Redeployment of ${name} is not allowed`,
      };
    }
  }

  const buffer = getRawPackageBuffer(pkg);

  try {
    const saveResult = (await context.storage.save(
      keyById,
      buffer,
    )) as SaveResult;
    const result = buildRawUploadResult(
      name,
      version,
      keyById,
      saveResult,
      buffer.length,
    );
    await indexRawArtifact(context, repo, result);
    return result;
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

async function saveHostedRawPut(
  context: PluginContext,
  repo: Repository,
  path: string,
  req: RawStorageRequest,
): Promise<RawStorageResult> {
  const name = path;
  const version = 'latest';
  const { keyById } = getRawStorageKeys(repo, name);

  if (!isRedeployAllowed(repo)) {
    const hasConflict = await hasRawRedeployConflict(
      context.storage,
      repo,
      name,
    );
    if (hasConflict) {
      return {
        ok: false,
        message: `Redeployment of ${name} is not allowed`,
      };
    }
  }

  try {
    if (canUseStreamUpload(context, req)) {
      const saveResult = (await context.storage.saveStream!(
        keyById,
        req,
      )) as SaveResult;
      const result = buildRawUploadResult(name, version, keyById, saveResult);
      await indexRawArtifact(context, repo, result);
      return result;
    }

    const buffer = await readRawRequestBuffer(req);
    const saveResult = (await context.storage.save(
      keyById,
      buffer,
    )) as SaveResult;
    const result = buildRawUploadResult(
      name,
      version,
      keyById,
      saveResult,
      buffer.length,
    );
    await indexRawArtifact(context, repo, result);
    return result;
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export function createRawUploader(context: PluginContext) {
  const upload = async (
    repo: Repository,
    pkg: RawPackage,
  ): Promise<RawStorageResult> => {
    if (repo.type === 'group') {
      return handleRawGroupUpload(context, repo, pkg, upload);
    }

    return createHostedRawUpload(context, repo, pkg);
  };

  return upload;
}

export function createRawPutHandler(context: PluginContext) {
  const handlePut = async (
    repo: Repository,
    path: string,
    req: RawStorageRequest,
  ): Promise<RawStorageResult> => {
    if (repo.type === 'group') {
      return handleRawGroupPut(context, repo, path, req, handlePut);
    }

    return saveHostedRawPut(context, repo, path, req);
  };

  return handlePut;
}
