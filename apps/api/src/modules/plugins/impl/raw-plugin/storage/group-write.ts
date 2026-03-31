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
  readRawRequestBuffer,
  type RawGroupConfig,
  type RawPackage,
  type RawPutOperation,
  type RawStorageRequest,
  type RawStorageResult,
  type RawWriteOperation,
} from './helpers';

async function getHostedMembers(
  context: PluginContext,
  memberIds: string[],
): Promise<Repository[]> {
  if (!context.getRepo) {
    return [];
  }

  const hostedMembers: Repository[] = [];
  for (const memberId of memberIds) {
    const member = await context.getRepo(memberId);
    if (member?.type === 'hosted') {
      hostedMembers.push(member);
    }
  }

  return hostedMembers;
}

export async function handleRawGroupUpload(
  context: PluginContext,
  repo: Repository,
  pkg: RawPackage,
  upload: RawWriteOperation,
): Promise<RawStorageResult> {
  const groupConfig = (repo.config ?? {}) as RawGroupConfig;
  const writePolicy = groupConfig.writePolicy || 'none';
  const members = groupConfig.members || [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  if (writePolicy === 'first') {
    const hostedMembers = await getHostedMembers(context, members);
    for (const member of hostedMembers) {
      const result = await upload(member, pkg);
      if (result.ok) {
        return result;
      }
    }

    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    const preferredWriter = groupConfig.preferredWriter;
    if (!preferredWriter) {
      return { ok: false, message: 'Preferred writer not configured' };
    }

    const member = await context.getRepo?.(preferredWriter);
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }

    return upload(member, pkg);
  }

  if (writePolicy === 'mirror') {
    const hostedMembers = await getHostedMembers(context, members);
    if (hostedMembers.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hostedMembers.map((member) => upload(member, pkg)),
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

export async function handleRawGroupPut(
  context: PluginContext,
  repo: Repository,
  path: string,
  req: RawStorageRequest,
  handlePut: RawPutOperation,
): Promise<RawStorageResult> {
  const groupConfig = (repo.config ?? {}) as RawGroupConfig;
  const writePolicy = groupConfig.writePolicy || 'none';
  const members = groupConfig.members || [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  const bufferedBody = await readRawRequestBuffer(req);
  const delegatedRequest: RawStorageRequest = {
    ...req,
    body: bufferedBody,
    buffer: bufferedBody,
  };

  if (writePolicy === 'first') {
    const hostedMembers = await getHostedMembers(context, members);
    for (const member of hostedMembers) {
      const result = await handlePut(member, path, delegatedRequest);
      if (result.ok) {
        return result;
      }
    }

    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    const preferredWriter = groupConfig.preferredWriter;
    if (!preferredWriter) {
      return { ok: false, message: 'Preferred writer not configured' };
    }

    const member = await context.getRepo?.(preferredWriter);
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }

    return handlePut(member, path, delegatedRequest);
  }

  if (writePolicy === 'mirror') {
    const hostedMembers = await getHostedMembers(context, members);
    if (hostedMembers.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hostedMembers.map((member) => handlePut(member, path, delegatedRequest)),
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
