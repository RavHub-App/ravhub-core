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
import {
  downloadSimpleIndex,
  readHostedArtifact,
  resolveRepo,
  type DownloadResult,
} from './download-support';
import { downloadProxyArtifact } from './download-proxy-support';

export function createPyPiDownloader(context: PluginContext) {
  const { storage } = context;

  async function downloadImpl(
    repo: Repository,
    name: string,
    version?: string,
  ): Promise<DownloadResult> {
    if (name === 'simple' || name.startsWith('simple/')) {
      return downloadSimpleIndex(storage, repo, name);
    }

    if (!version) {
      const parts = name.split('/');
      if (parts.length >= 2) {
        version = parts.pop();
        name = parts.join('/');
      } else {
        return { ok: false, message: 'Version required for download' };
      }
    }

    if (repo.type === 'group') {
      const members = (repo.config?.members || []) as string[];
      for (const id of members) {
        const member = await resolveRepo(context, id);
        if (!member) {
          continue;
        }
        const result = await downloadImpl(member, name, version);
        if (result.ok) {
          return result;
        }
      }
      return { ok: false, message: 'Not found in group' };
    }

    if (!version) {
      return { ok: false, message: 'Version is required' };
    }

    const hosted = await readHostedArtifact(storage, repo, name, version);
    if (hosted) {
      return {
        ok: true,
        data: hosted,
        contentType: 'application/octet-stream',
      };
    }

    if (repo.type === 'proxy') {
      return downloadProxyArtifact(context, repo, name, version);
    }

    return { ok: false, message: 'Not found' };
  }

  return downloadImpl;
}
