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
import { getRawStorageKeys, type RawStorageResult } from './helpers';

export function createRawDownloader(context: PluginContext) {
  const download = async (
    repo: Repository,
    name: string,
    _version?: string,
  ): Promise<RawStorageResult> => {
    if (repo.type === 'group') {
      const members = repo.config?.members || [];

      for (const memberId of members) {
        const member = await context.getRepo?.(memberId);
        if (!member) {
          continue;
        }

        const result = await download(member, name);
        if (result.ok) {
          return result;
        }
      }

      return { ok: false, message: 'Not found in group' };
    }

    const { keyById, keyByName } = getRawStorageKeys(repo, name);

    try {
      const dataById = await context.storage.get(keyById).catch(() => null);
      const data =
        dataById ?? (await context.storage.get(keyByName).catch(() => null));
      if (!data) {
        return { ok: false, message: 'Not found' };
      }

      return {
        ok: true,
        data,
        contentType: 'application/octet-stream',
      };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };

  return download;
}
