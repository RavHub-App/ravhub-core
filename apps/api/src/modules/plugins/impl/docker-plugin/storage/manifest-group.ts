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
import {
  buildGroupManifestSuccess,
  getHostedManifestMembers,
  getManifestGroupMembers,
  isHostedRepo,
  resolveManifestGroupWritePolicy,
  resolvePreferredHostedManifestRepo,
} from './manifest-group-support';

type PutManifestResult = {
  ok: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
};

type PutManifestFn = (
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId?: string,
) => Promise<PutManifestResult>;

export async function routeGroupManifestPut(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId: string | undefined,
  getRepo: ((id: string) => Promise<Repository | null>) | null,
  putManifest: PutManifestFn,
) {
  const writePolicy = resolveManifestGroupWritePolicy(repo);

  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[PUT MANIFEST GROUP] repo=${repo.name}, policy=${writePolicy}, name=${name}, tag=${tag}`,
    );
  }

  if (writePolicy === 'none') {
    return { ok: false, message: 'group writePolicy is none (read-only)' };
  }

  const members = getManifestGroupMembers(repo);
  if (members.length === 0) {
    return { ok: false, message: 'group has no members' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    return routePreferredManifestPut(
      repo,
      name,
      tag,
      manifest,
      userId,
      members,
      writePolicy,
      getRepo,
      putManifest,
    );
  }

  if (writePolicy === 'first') {
    return routeFirstManifestPut(
      repo,
      name,
      tag,
      manifest,
      userId,
      members,
      getRepo,
      putManifest,
    );
  }

  if (writePolicy === 'mirror') {
    return routeMirrorManifestPut(
      repo,
      name,
      tag,
      manifest,
      userId,
      members,
      getRepo,
      putManifest,
    );
  }

  return {
    ok: false,
    message: `unsupported writePolicy: ${writePolicy}`,
  };
}

async function routePreferredManifestPut(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId: string | undefined,
  members: string[],
  writePolicy: string,
  getRepo: ((id: string) => Promise<Repository | null>) | null,
  putManifest: PutManifestFn,
) {
  const preferredResolution = await resolvePreferredHostedManifestRepo(
    repo,
    members,
    writePolicy,
    getRepo,
  );
  if (!preferredResolution.ok) {
    return preferredResolution;
  }
  const { targetRepo } = preferredResolution;

  const result = await putManifest(targetRepo, name, tag, manifest, userId);
  if (!result?.ok) {
    return result;
  }

  return buildGroupManifestSuccess(result, repo, {
    writePolicy,
    targetRepoId: targetRepo.id,
  });
}

async function routeFirstManifestPut(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId: string | undefined,
  members: string[],
  getRepo: ((id: string) => Promise<Repository | null>) | null,
  putManifest: PutManifestFn,
) {
  for (const memberId of members) {
    const child = await getRepo?.(memberId);
    if (!isHostedRepo(child)) {
      continue;
    }

    const result = await putManifest(child, name, tag, manifest, userId);
    if (!result?.ok) {
      continue;
    }

    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug(
        `[PUT MANIFEST GROUP FIRST] wrote to ${child.name} (${memberId})`,
      );
    }

    return buildGroupManifestSuccess(result, repo, {
      writePolicy: 'first',
      targetRepoId: memberId,
    });
  }

  return {
    ok: false,
    message: 'no members accepted write (first policy)',
  };
}

async function routeMirrorManifestPut(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId: string | undefined,
  members: string[],
  getRepo: ((id: string) => Promise<Repository | null>) | null,
  putManifest: PutManifestFn,
) {
  const hostedMembers = await getHostedManifestMembers(members, getRepo);
  if (hostedMembers.length === 0) {
    return { ok: false, message: 'No hosted members found' };
  }

  const results = await Promise.all(
    hostedMembers.map((member) =>
      putManifest(member, name, tag, manifest, userId),
    ),
  );

  const success = results.find((result) => result.ok);
  if (!success) {
    return { ok: false, message: 'Mirror write failed on all members' };
  }

  return buildGroupManifestSuccess(success, repo, {
    writePolicy: 'mirror',
  });
}
