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

type WriteResult = {
  ok?: boolean;
  message?: string;
};

async function getHostedMembers(
  context: PluginContext,
  memberIds: string[],
): Promise<Repository[]> {
  const hosted: Repository[] = [];
  if (!context.getRepo) return hosted;

  for (const id of memberIds) {
    const repo = (await context.getRepo(id)) as Repository | null;
    if (repo && repo.type === 'hosted') {
      hosted.push(repo);
    }
  }

  return hosted;
}

export async function handleRustGroupUpload(
  context: PluginContext,
  repo: Repository,
  pkg: any,
  upload: (repo: Repository, pkg: any) => Promise<WriteResult>,
): Promise<WriteResult> {
  const writePolicy = repo.config?.writePolicy || 'none';
  const members = repo.config?.members || [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  if (writePolicy === 'first') {
    const hosted = await getHostedMembers(context, members);
    for (const member of hosted) {
      const result = await upload(member, pkg);
      if (result.ok) return result;
    }
    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    const preferredId = repo.config?.preferredWriter;
    if (!preferredId) {
      return { ok: false, message: 'Preferred writer not configured' };
    }

    const member = (await context.getRepo?.(preferredId)) as Repository | null;
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }

    return upload(member, pkg);
  }

  if (writePolicy === 'mirror') {
    const hosted = await getHostedMembers(context, members);
    if (hosted.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hosted.map((member) => upload(member, pkg)),
    );
    return (
      results.find((result) => result.ok) || {
        ok: false,
        message: 'Mirror write failed',
      }
    );
  }

  return { ok: false, message: 'Unknown write policy' };
}
