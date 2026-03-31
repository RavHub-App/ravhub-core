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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import {
  readHelmRequestBuffer,
  resolveHelmRepo,
  type HelmPackage,
  type HelmRepository,
  type HelmStorageRequest,
} from './helpers';

type HelmUploadResult = {
  ok: boolean;
  id?: string;
  message?: string;
  metadata?: {
    name?: string;
    version?: string;
    storageKey: string;
    size?: number;
    contentHash?: string;
  };
};

async function getHostedMembers(
  context: PluginContext,
  repo: HelmRepository,
): Promise<HelmRepository[]> {
  const members = repo.config?.members || [];
  const hostedMembers: HelmRepository[] = [];

  for (const memberId of members) {
    const member = await resolveHelmRepo(context, memberId);
    if (member && member.type === 'hosted') {
      hostedMembers.push(member as HelmRepository);
    }
  }

  return hostedMembers;
}

export async function handleHelmGroupUpload(
  context: PluginContext,
  repo: HelmRepository,
  pkg: HelmPackage,
  upload: (repo: HelmRepository, pkg: HelmPackage) => Promise<HelmUploadResult>,
): Promise<HelmUploadResult> {
  const writePolicy = repo.config?.writePolicy || 'none';

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  if (writePolicy === 'first') {
    const hostedMembers = await getHostedMembers(context, repo);
    for (const member of hostedMembers) {
      const result = await upload(member, pkg);
      if (result.ok) {
        return result;
      }
    }

    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred') {
    const preferredWriter = repo.config?.preferredWriter;
    if (!preferredWriter) {
      return { ok: false, message: 'Preferred writer not configured' };
    }

    const member = await resolveHelmRepo(context, preferredWriter);
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }

    return upload(member as HelmRepository, pkg);
  }

  if (writePolicy === 'mirror') {
    const hostedMembers = await getHostedMembers(context, repo);
    if (hostedMembers.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hostedMembers.map((member) => upload(member, pkg)),
    );
    return (
      results.find((result) => result.ok) || {
        ok: false,
        message: 'Mirror upload failed',
      }
    );
  }

  return { ok: false, message: 'Unknown write policy' };
}

export async function handleHelmGroupPut(
  context: PluginContext,
  repo: HelmRepository,
  filePath: string,
  req: HelmStorageRequest,
  handlePut: (
    repo: HelmRepository,
    filePath: string,
    req: HelmStorageRequest,
  ) => Promise<HelmUploadResult>,
): Promise<HelmUploadResult> {
  const writePolicy = repo.config?.writePolicy || 'none';

  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  const bufferedBody = await readHelmRequestBuffer(req);
  const delegatedRequest = { ...req, body: bufferedBody, buffer: bufferedBody };

  if (writePolicy === 'first') {
    const hostedMembers = await getHostedMembers(context, repo);
    for (const member of hostedMembers) {
      const result = await handlePut(member, filePath, delegatedRequest);
      if (result.ok) {
        return result;
      }
    }

    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred') {
    const preferredWriter = repo.config?.preferredWriter;
    if (!preferredWriter) {
      return { ok: false, message: 'Preferred writer not configured' };
    }

    const member = await resolveHelmRepo(context, preferredWriter);
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }

    return handlePut(member as HelmRepository, filePath, delegatedRequest);
  }

  if (writePolicy === 'mirror') {
    const hostedMembers = await getHostedMembers(context, repo);
    if (hostedMembers.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }

    const results = await Promise.all(
      hostedMembers.map((member) =>
        handlePut(member, filePath, delegatedRequest),
      ),
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
