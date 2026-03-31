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
  getRequestBodyBuffer,
  type NugetConfig,
  type NugetPackage,
  type NugetStorageRequest,
  type NugetUploadResult,
} from './storage-helpers';

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

export async function handleNugetGroupUpload(
  context: PluginContext,
  repo: Repository,
  pkg: NugetPackage,
  upload: (repo: Repository, pkg: NugetPackage) => Promise<NugetUploadResult>,
): Promise<NugetUploadResult> {
  const config = (repo.config ?? {}) as NugetConfig;
  const writePolicy = config.writePolicy || 'none';
  const members = config.members || [];

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
    const preferredId = config.preferredWriter;
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

export async function handleNugetGroupPut(
  context: PluginContext,
  repo: Repository,
  path: string,
  req: NugetStorageRequest,
  handlePut: (
    repo: Repository,
    path: string,
    req: NugetStorageRequest,
  ) => Promise<NugetUploadResult>,
): Promise<NugetUploadResult> {
  const config = (repo.config ?? {}) as NugetConfig;
  const writePolicy = config.writePolicy || 'none';
  const members = config.members || [];

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  const body = await getRequestBodyBuffer(req);
  const newReq = { ...req, body, buffer: body };

  if (writePolicy === 'first') {
    const hosted = await getHostedMembers(context, members);
    for (const member of hosted) {
      try {
        const result = await handlePut(member, path, newReq);
        if (result.ok) return result;
        console.warn(
          `[NuGetPlugin] Group handlePut failed for member ${member.id}: ${result.message || 'Unknown error'}`,
        );
      } catch (error) {
        console.warn(
          `[NuGetPlugin] Group handlePut failed for member ${member.id}: ${String(error)}`,
        );
      }
    }
    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    const preferredId = config.preferredWriter;
    if (!preferredId) {
      return { ok: false, message: 'Preferred writer not configured' };
    }
    const member = (await context.getRepo?.(preferredId)) as Repository | null;
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }
    return handlePut(member, path, newReq);
  }

  if (writePolicy === 'mirror') {
    const hosted = await getHostedMembers(context, members);
    if (hosted.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hosted.map((member) => handlePut(member, path, newReq)),
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
