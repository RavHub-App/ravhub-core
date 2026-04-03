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

import type { Repository } from '../utils/types';
import * as fs from 'fs';
import { Readable } from 'stream';
import {
  appendGroupUpload,
  finalizeGroupUpload,
  initiateGroupUpload,
} from './group-upload';
import {
  createUploadUuid,
  deleteUploadMeta,
  deleteUploadTarget,
  getTempFilePath,
  getUploadMeta,
  getUploadTarget,
  setUploadMeta,
} from './upload-session';
import {
  appendHostedUpload,
  createGroupUploadDependencies,
  finalizeHostedUpload,
} from './upload-support';

let storage: any = null;
let getRepo: any = null;
let redis: any = null;
let trackUpload: any = null;

export function initUpload(context: {
  storage: any;
  getRepo?: any;
  redis?: any;
  trackUpload?: any;
}) {
  storage = context.storage;
  getRepo = context.getRepo;
  redis = context.redis;
  trackUpload = context.trackUpload;
}

export async function initiateUpload(repo: Repository, name: string) {
  if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
    return {
      ok: false,
      message: 'proxy repositories are read-only (pulls only from upstream)',
    };
  }

  if ((repo?.type || '').toString().toLowerCase() === 'group') {
    return initiateGroupUpload(
      repo,
      name,
      createGroupUploadDependencies(getRepo, redis, {
        initiateUpload,
        appendUpload,
        finalizeUpload,
      }),
    );
  }

  const uuid = createUploadUuid();
  const filePath = getTempFilePath(uuid);
  fs.writeFileSync(filePath, Buffer.alloc(0));

  await setUploadMeta(redis, uuid, { startedAt: Date.now(), repoId: repo.id });

  return { ok: true, uuid };
}

export async function appendUpload(
  repo: Repository,
  uuid: string,
  digest?: string,
  buffer?: Buffer,
  stream?: Readable,
) {
  const delegatedResult = await appendGroupUpload(
    uuid,
    digest,
    buffer,
    stream,
    createGroupUploadDependencies(getRepo, redis, {
      initiateUpload,
      appendUpload,
      finalizeUpload,
    }),
  );
  if (delegatedResult) {
    return delegatedResult;
  }

  return await appendHostedUpload(redis, uuid, buffer, stream);
}

export async function finalizeUpload(
  repo: Repository,
  name: string,
  uuid: string,
  digest?: string,
  buffer?: Buffer,
  stream?: Readable,
) {
  const delegatedResult = await finalizeGroupUpload(
    repo,
    name,
    uuid,
    digest,
    buffer,
    stream,
    createGroupUploadDependencies(getRepo, redis, {
      initiateUpload,
      appendUpload,
      finalizeUpload,
    }),
  );
  if (delegatedResult) {
    if (delegatedResult.ok) {
      await trackCompletedUpload(repo, name, digest);
    }
    return delegatedResult;
  }

  const result = await finalizeHostedUpload(
    storage,
    redis,
    repo,
    uuid,
    digest,
    buffer,
    stream,
  );

  if (result?.ok) {
    await trackCompletedUpload(repo, name, digest || result.id);
  }

  return result;
}

async function trackCompletedUpload(
  repo: Repository,
  name: string,
  digest?: string,
) {
  if (typeof trackUpload !== 'function') {
    return;
  }

  try {
    await trackUpload(repo, name, digest);
  } catch {
    return;
  }
}
