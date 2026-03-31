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
import { createNpmDownloader } from './download';
import { handleNpmGroupPut } from './group-write';
import {
  getNpmMetadataPath,
  readNpmRequestBody,
  saveNpmFile,
  saveNpmFileStream,
  updateNpmPackageMetadata,
} from './storage-helpers';

export function initStorage(context: PluginContext, proxyFetch?: any) {
  const { storage } = context;
  const pendingDownloads = new Map<string, Promise<any>>();
  const download = createNpmDownloader(context, pendingDownloads, proxyFetch);

  const saveFile = async (repo: Repository, path: string, data: Buffer) => {
    return saveNpmFile(storage, repo, path, data);
  };

  const saveFileStream = async (
    repo: Repository,
    path: string,
    stream: any,
  ) => {
    return saveNpmFileStream(storage, repo, path, stream);
  };

  const getFile = async (repo: Repository, path: string) => {
    return (await import('./storage-helpers')).getNpmFile(storage, repo, path);
  };

  const handlePut = async (
    repo: Repository,
    path: string,
    req: any,
  ): Promise<any> => {
    if (repo.type === 'group') {
      return handleNpmGroupPut(context, repo, path, req, handlePut);
    }

    if (
      path.includes('/-/') &&
      !req.body &&
      (!req.buffer || req.buffer.length === 0)
    ) {
      const res = await saveFileStream(repo, path, req);
      return {
        ok: res.ok,
        message: 'File uploaded (stream)',
        metadata: { ...res, storageKey: res.path },
      };
    }

    const { buffer, incoming } = await readNpmRequestBody(req);

    if (path.includes('/-/')) {
      await saveFile(repo, path, buffer);
      return { ok: true, message: 'File uploaded' };
    }

    if (!incoming) {
      return { ok: false, message: 'Invalid JSON metadata' };
    }

    try {
      const metaPath = getNpmMetadataPath(path);
      const { merged, metaResult, lastAttachmentResult } =
        await updateNpmPackageMetadata(context, repo, metaPath, incoming);

      const result = {
        ok: true,
        message: 'Package published',
        metadata: {
          name: merged.name,
          version:
            merged['dist-tags']?.latest ||
            Object.keys(merged.versions).pop() ||
            '0.0.0',
          storageKey: metaPath,
          size: lastAttachmentResult?.size ?? metaResult.size,
          contentHash:
            lastAttachmentResult?.contentHash ?? metaResult.contentHash,
        },
      };

      // Index artifact in DB for UI listing
      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, result);
        } catch (e) {
          console.warn(
            `[NPM] Failed to index artifact ${metaPath}: ${String(e)}`,
          );
        }
      }

      return result;
    } catch (err: any) {
      console.warn(
        `[NPM] Failed to update package metadata ${path}: ${String(err)}`,
      );
      return { ok: false, message: String(err) };
    }
  };

  return {
    saveFile,
    getFile,
    handlePut,
    download,
  };
}
