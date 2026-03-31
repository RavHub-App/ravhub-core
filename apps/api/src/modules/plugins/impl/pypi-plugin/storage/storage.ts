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

import { PluginContext, Repository } from '../utils/types';
import { createPyPiDownloader } from './download';
import { handlePyPiGroupPut, handlePyPiGroupUpload } from './group-write';
import {
  getPyPiPackageKeys,
  getPyPiUploadBuffer,
  parsePyPiStoragePath,
  readPyPiRequestBuffer,
} from './storage-helpers';
import {
  buildPyPiArtifactResult,
  ensurePyPiPutRedeployAllowed,
  ensurePyPiUploadRedeployAllowed,
} from './storage-write-support';

export function initStorage(context: PluginContext) {
  const { storage } = context;
  const download = createPyPiDownloader(context);

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    if (repo.type === 'group') {
      return handlePyPiGroupUpload(context, repo, pkg, upload);
    }

    const name = pkg?.name || 'pkg';
    const version = pkg?.version || '0.0.1';
    const filename = pkg?.filename || `${name}-${version}.tar.gz`;
    const { keyId, keyName } = getPyPiPackageKeys(
      repo,
      name,
      version,
      filename,
    );
    const buf = getPyPiUploadBuffer(pkg);
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    const redeployError = await ensurePyPiUploadRedeployAllowed(
      storage,
      allowRedeploy,
      keyId,
      keyName,
      name,
      version,
    );
    if (redeployError) {
      return redeployError;
    }

    try {
      const result = await storage.save(keyId, buf);
      return buildPyPiArtifactResult(
        context,
        repo,
        'uploaded',
        name,
        version,
        keyId,
        result.size ?? buf.length,
        result.contentHash,
      );
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    if (repo.type === 'group') {
      return handlePyPiGroupPut(context, repo, path, req, handlePut);
    }

    const { name, version, filename } = parsePyPiStoragePath(path);
    const { keyId, keyName } = getPyPiPackageKeys(
      repo,
      name,
      version,
      filename,
    );
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    const redeployError = await ensurePyPiPutRedeployAllowed(
      storage,
      allowRedeploy,
      keyId,
      keyName,
      name,
      version,
    );
    if (redeployError) {
      return redeployError;
    }

    try {
      let result: any;
      if (
        typeof storage.saveStream === 'function' &&
        !req.body &&
        !req.buffer
      ) {
        result = await storage.saveStream(keyId, req);
      } else {
        const buf = await readPyPiRequestBuffer(req);
        await storage.save(keyId, buf);
        result = { ok: true, size: buf.length };
      }

      return buildPyPiArtifactResult(
        context,
        repo,
        'put',
        name,
        version,
        keyId,
        result.size,
        result.contentHash,
      );
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { upload, download, handlePut };
}
