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
import { readPyPiRequestBuffer } from './storage-helpers';

type WriteResult = {
  ok?: boolean;
  message?: string;
};

async function getHostedMembers(
  context: PluginContext,
  memberIds: string[],
): Promise<Repository[]> {
  const hosted: Repository[] = [];
  if (!context.getRepo) {
    return hosted;
  }

  for (const id of memberIds) {
    try {
      const member = (await context.getRepo(id)) as Repository | null;
      if (member && member.type === 'hosted') {
        hosted.push(member);
      }
    } catch (error) {
      console.warn(
        `[PyPIPlugin] Failed to resolve repository ${id}: ${String(error)}`,
      );
    }
  }

  return hosted;
}

export async function handlePyPiGroupUpload(
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
      if (result.ok) {
        return result;
      }
      if (result.message) {
        console.warn(
          `[PyPIPlugin] Group upload failed for member ${member.id}: ${result.message}`,
        );
      }
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
        message: 'Mirror write failed on all members',
      }
    );
  }

  return { ok: false, message: 'Unknown write policy' };
}

export async function handlePyPiGroupPut(
  context: PluginContext,
  repo: Repository,
  path: string,
  req: any,
  handlePut: (repo: Repository, path: string, req: any) => Promise<WriteResult>,
): Promise<WriteResult> {
  const writePolicy = repo.config?.writePolicy || 'none';
  const members = repo.config?.members || [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  const body = await readPyPiRequestBuffer(req);
  const delegatedRequest = { body };

  if (writePolicy === 'first') {
    const hosted = await getHostedMembers(context, members);
    for (const member of hosted) {
      const result = await handlePut(member, path, delegatedRequest);
      if (result.ok) {
        return result;
      }
      if (result.message) {
        console.warn(
          `[PyPIPlugin] Group handlePut failed for member ${member.id}: ${result.message}`,
        );
      }
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
    return handlePut(member, path, delegatedRequest);
  }

  if (writePolicy === 'mirror') {
    const hosted = await getHostedMembers(context, members);
    if (hosted.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }
    const results = await Promise.all(
      hosted.map((member) => handlePut(member, path, delegatedRequest)),
    );
    return (
      results.find((result) => result.ok) || {
        ok: false,
        message: 'Mirror write failed on all members',
      }
    );
  }

  return { ok: false, message: 'Unknown write policy' };
}
