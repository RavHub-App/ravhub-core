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

import { Readable } from 'stream';
import type { Repository } from '../utils/types';
import { readStreamToBuffer } from './upload-session';
import type { GroupDependencies, GroupTracking } from './group-upload';

export async function appendGroupUpload(
  uuid: string,
  digest: string | undefined,
  buffer: Buffer | undefined,
  stream: Readable | undefined,
  dependencies: GroupDependencies,
) {
  const tracking = await dependencies.getUploadTarget(uuid);
  if (!tracking) {
    return null;
  }

  const delegatedBuffer =
    !buffer && stream ? await readStreamToBuffer(stream) : buffer;
  const results = await Promise.all(
    tracking.targets.map(async (target) => {
      const targetRepo = await dependencies.getRepo?.(target.repoId);
      if (!targetRepo) {
        return { ok: false, message: 'Target repo not found' };
      }

      return dependencies.appendUpload(
        targetRepo,
        target.uuid,
        digest,
        delegatedBuffer,
      );
    }),
  );

  const success = results.find((result: any) => result.ok);
  return success
    ? { ok: true, uploaded: success.uploaded }
    : { ok: false, message: 'Append failed on all targets' };
}

export async function finalizeGroupUpload(
  repo: Repository,
  name: string,
  uuid: string,
  digest: string | undefined,
  buffer: Buffer | undefined,
  stream: Readable | undefined,
  dependencies: GroupDependencies,
) {
  const tracking = (await dependencies.getUploadTarget(
    uuid,
  )) as GroupTracking | null;
  if (!tracking) {
    return null;
  }

  const delegatedBuffer =
    !buffer && stream ? await readStreamToBuffer(stream) : buffer;
  const results = await Promise.all(
    tracking.targets.map(async (target) => {
      const targetRepo = await dependencies.getRepo?.(target.repoId);
      if (!targetRepo) {
        return { ok: false, message: 'Target repo not found' };
      }

      return dependencies.finalizeUpload(
        targetRepo,
        name,
        target.uuid,
        digest,
        delegatedBuffer,
      );
    }),
  );

  const success = results.find((result: any) => result.ok);
  if (!success) {
    return { ok: false, message: 'Finalize failed' };
  }

  await dependencies.deleteUploadTarget(uuid);
  return success;
}
