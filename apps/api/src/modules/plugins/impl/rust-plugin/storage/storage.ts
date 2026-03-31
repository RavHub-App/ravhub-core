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
import { PluginContext, Repository } from '../utils/types';
import { createRustDownloader } from './download';
import { handleRustGroupUpload } from './group-write';
import { createRustProxyDownloader } from './proxy-download';
import {
  getBufferFromPkg,
  parseCratePath,
  readRequestBuffer,
} from './storage-helpers';
import {
  buildRustUploadResult,
  updateRustIndexEntry,
} from './storage-write-support';

export function initStorage(context: PluginContext) {
  const { storage } = context;
  const proxyDownload = createRustProxyDownloader(context);
  const download = createRustDownloader(context, proxyDownload);

  const handleGroupUpload = async (
    repo: Repository,
    pkg: any,
    uploadFn: (r: Repository, p: any) => Promise<any>,
  ): Promise<any> => {
    return handleRustGroupUpload(context, repo, pkg, uploadFn);
  };

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    if (repo.type === 'group') return handleGroupUpload(repo, pkg, upload);

    const name = pkg?.name || 'crate';
    const version = pkg?.version || '0.1.0';
    const fileName = `${name}-${version}.crate`;
    const keyId = buildKey('rust', repo.id, 'crates', name, version, fileName);

    const buf = getBufferFromPkg(pkg);

    if (repo.config?.allowRedeploy === false) {
      if (await storage.exists(keyId).catch(() => false))
        return { ok: false, message: `Redeployment not allowed` };
    }

    try {
      const result = await storage.save(keyId, buf);
      await updateRustIndexEntry(
        context,
        storage,
        repo,
        name,
        version,
        buf,
        pkg,
      );

      return buildRustUploadResult(
        context,
        repo,
        name,
        version,
        keyId,
        buf,
        result,
      );
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    const buf = await readRequestBuffer(req);
    const { name, version } = parseCratePath(path);
    return upload(repo, { content: buf, name, version });
  };

  return { upload, download, handlePut, proxyDownload };
}
