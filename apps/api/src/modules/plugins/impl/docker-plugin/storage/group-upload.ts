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
import { createUploadUuid } from './upload-session';
export {
  appendGroupUpload,
  finalizeGroupUpload,
} from './group-upload-delegation';

type UploadTarget = { repoId: string; uuid: string };

export type GroupTracking = {
  groupId: string;
  targets: UploadTarget[];
  policy: string;
};

export type GroupDependencies = {
  getRepo: ((id: string) => Promise<Repository | null>) | null;
  initiateUpload: (repo: Repository, name: string) => Promise<any>;
  appendUpload: (
    repo: Repository,
    uuid: string,
    digest?: string,
    buffer?: Buffer,
  ) => Promise<any>;
  finalizeUpload: (
    repo: Repository,
    name: string,
    uuid: string,
    digest?: string,
    buffer?: Buffer,
  ) => Promise<any>;
  setUploadTarget: (uuid: string, target: GroupTracking) => Promise<void>;
  getUploadTarget: (uuid: string) => Promise<GroupTracking | null>;
  deleteUploadTarget: (uuid: string) => Promise<void>;
};

export async function initiateGroupUpload(
  repo: Repository,
  name: string,
  dependencies: GroupDependencies,
) {
  const writePolicy = ((repo?.config as any)?.writePolicy || 'none')
    .toString()
    .toLowerCase();
  const members = Array.isArray((repo?.config as any)?.members)
    ? ((repo?.config as any).members as string[])
    : [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'group writePolicy is none' };
  }

  if (members.length === 0) {
    return { ok: false, message: 'group has no members' };
  }

  if (!dependencies.getRepo) {
    return { ok: false, message: 'group routing is unavailable' };
  }

  if (writePolicy === 'first') {
    return initiateFirstGroupUpload(repo, name, members, dependencies);
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    return initiatePreferredGroupUpload(repo, name, members, dependencies);
  }

  if (writePolicy === 'mirror') {
    return initiateMirroredGroupUpload(repo, name, members, dependencies);
  }

  return { ok: false, message: `unsupported writePolicy: ${writePolicy}` };
}

async function initiateFirstGroupUpload(
  repo: Repository,
  name: string,
  members: string[],
  dependencies: GroupDependencies,
) {
  for (const memberId of members) {
    const child = await dependencies.getRepo?.(memberId);
    if (!isHostedRepo(child)) {
      continue;
    }

    const result = await dependencies.initiateUpload(child, name);
    if (!result.ok) {
      continue;
    }

    await dependencies.setUploadTarget(result.uuid, {
      groupId: repo.id,
      targets: [{ repoId: memberId, uuid: result.uuid }],
      policy: 'first',
    });
    return result;
  }

  return { ok: false, message: 'no members accepted write (first policy)' };
}

async function initiatePreferredGroupUpload(
  repo: Repository,
  name: string,
  members: string[],
  dependencies: GroupDependencies,
) {
  const writePolicy = ((repo.config as any)?.writePolicy || 'preferred')
    .toString()
    .toLowerCase();
  const preferredWriter = (repo.config as any)?.preferredWriter;

  if (!preferredWriter) {
    return {
      ok: false,
      message: `writePolicy=${writePolicy} requires preferredWriter`,
    };
  }

  if (!members.includes(preferredWriter)) {
    return { ok: false, message: 'preferredWriter not in members' };
  }

  const targetRepo = await dependencies.getRepo?.(preferredWriter);
  if (!targetRepo) {
    return {
      ok: false,
      message: `preferredWriter ${preferredWriter} not found`,
    };
  }

  if (!isHostedRepo(targetRepo)) {
    return {
      ok: false,
      message: `preferredWriter ${preferredWriter} is not hosted`,
    };
  }

  if (writePolicy === 'preferred') {
    const result = await dependencies.initiateUpload(targetRepo, name);
    if (result?.ok && result.uuid) {
      await dependencies.setUploadTarget(result.uuid, {
        groupId: repo.id,
        targets: [{ repoId: targetRepo.id, uuid: result.uuid }],
        policy: writePolicy,
      });
    }
    return result;
  }

  return initiateMultiTargetGroupUpload(
    repo,
    name,
    members,
    dependencies,
    writePolicy,
  );
}

async function initiateMirroredGroupUpload(
  repo: Repository,
  name: string,
  members: string[],
  dependencies: GroupDependencies,
) {
  return initiateMultiTargetGroupUpload(
    repo,
    name,
    members,
    dependencies,
    'mirror',
  );
}

async function initiateMultiTargetGroupUpload(
  repo: Repository,
  name: string,
  members: string[],
  dependencies: GroupDependencies,
  policy: string,
) {
  const hostedMembers = await getHostedMembers(members, dependencies.getRepo);
  if (hostedMembers.length === 0) {
    return { ok: false, message: 'No hosted members found' };
  }

  const uploads = await Promise.all(
    hostedMembers.map(async (member) => {
      const result = await dependencies.initiateUpload(member, name);
      return {
        repoId: member.id,
        uuid: result?.uuid,
        ok: Boolean(result?.ok && result?.uuid),
      };
    }),
  );

  const successfulUploads = uploads.filter((upload) => upload.ok);
  if (successfulUploads.length === 0) {
    return {
      ok: false,
      message:
        policy === 'broadcast'
          ? 'Broadcast write failed on all members'
          : 'Mirror write failed on all members',
    };
  }

  const groupUuid = createUploadUuid();
  await dependencies.setUploadTarget(groupUuid, {
    groupId: repo.id,
    targets: successfulUploads.map(({ repoId, uuid }) => ({
      repoId,
      uuid: uuid as string,
    })),
    policy,
  });

  return { ok: true, uuid: groupUuid };
}

async function getHostedMembers(
  members: string[],
  getRepo: GroupDependencies['getRepo'],
) {
  const hostedMembers: Repository[] = [];
  for (const memberId of members) {
    const member = await getRepo?.(memberId);
    if (isHostedRepo(member)) {
      hostedMembers.push(member);
    }
  }
  return hostedMembers;
}

function isHostedRepo(repo: Repository | null | undefined): repo is Repository {
  return Boolean(
    repo && (repo.type || '').toString().toLowerCase() === 'hosted',
  );
}
