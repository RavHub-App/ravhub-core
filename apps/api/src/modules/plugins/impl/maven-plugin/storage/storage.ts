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
import { normalizeRepoPath } from '../utils/maven';
import { createMavenDownloader } from './download';
import { handleMavenGroupPut, handleMavenGroupUpload } from './group-write';
import {
  buildMavenStoredArtifactResult,
  describeMavenArtifact,
  hasMavenRedeployConflict,
  indexMavenArtifact,
} from './storage-write-support';
import {
  checksumAlgoForPath,
  getContentBuffer,
  streamToBuffer,
} from './storage-helpers';

export function initStorage(context: PluginContext) {
  const { storage } = context;
  const download = createMavenDownloader(context);

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    if (repo.type === 'group') {
      return handleMavenGroupUpload(context, repo, pkg, upload);
    }

    const repoPath = normalizeRepoPath(
      pkg?.path || pkg?.name || 'com/example/artifact/1.0.0/artifact-1.0.0.pom',
    );
    const buf = getContentBuffer(pkg);

    const artifact = describeMavenArtifact(repo, repoPath, pkg);

    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (
      !allowRedeploy &&
      !artifact.isSnapshot &&
      !artifact.isMetadataOrChecksum &&
      (await hasMavenRedeployConflict(storage, artifact, true))
    ) {
      return {
        ok: false,
        message: `Redeployment of ${artifact.packageName}:${artifact.version} is not allowed`,
      };
    }

    try {
      await storage.save(artifact.keyId, buf);
      const uploadResult = buildMavenStoredArtifactResult(artifact, {
        size: buf.length,
      });
      await indexMavenArtifact(context, repo, artifact, uploadResult);

      return uploadResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, repoPath: string, req: any) => {
    if (repo.type === 'group') {
      return handleMavenGroupPut(context, repo, repoPath, req, handlePut);
    }

    const p = normalizeRepoPath(repoPath);
    const artifact = describeMavenArtifact(repo, p);

    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (
      !allowRedeploy &&
      artifact.version &&
      !artifact.isSnapshot &&
      !artifact.isMetadataOrChecksum &&
      (await hasMavenRedeployConflict(storage, artifact, false))
    ) {
      throw new Error(
        `Redeployment of ${artifact.packageName || ''}:${artifact.version} is not allowed`,
      );
    }

    let result: { ok?: boolean; size?: number; contentHash?: string };
    if (typeof storage.saveStream === 'function' && !req.body && !req.buffer) {
      result = await storage.saveStream(artifact.keyId, req);
    } else {
      let buf: Buffer;
      if (req.body && Buffer.isBuffer(req.body)) {
        buf = req.body;
      } else if (req.buffer && Buffer.isBuffer(req.buffer)) {
        buf = req.buffer;
      } else if (typeof req.body === 'string') {
        buf = Buffer.from(req.body);
      } else if (
        req.body &&
        typeof req.body === 'object' &&
        Object.keys(req.body).length > 0
      ) {
        throw new Error(
          'Body already parsed. Please use Content-Type: application/octet-stream or similar.',
        );
      } else {
        buf = await streamToBuffer(req);
      }
      await storage.save(artifact.keyId, buf);
      result = { ok: true, size: buf.length };
    }

    const putResult = buildMavenStoredArtifactResult(artifact, result);
    await indexMavenArtifact(context, repo, artifact, putResult);

    return putResult;
  };

  return { upload, download, handlePut };
}
