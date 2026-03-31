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

type ComposerGroupConfig = {
  writePolicy?: string;
  members?: string[];
  preferredWriter?: string;
};

type WritablePackage = {
  content?: unknown;
  encoding?: string;
  name?: string;
  version?: string;
};

type WriteResult = {
  ok?: boolean;
  message?: string;
};

type WriteOperation = (
  repo: Repository,
  pkg: WritablePackage,
) => Promise<WriteResult>;

export function getBufferFromPkg(pkg: WritablePackage): Buffer {
  const data = pkg.content ?? JSON.stringify(pkg ?? {});
  if (pkg.encoding === 'base64' && typeof data === 'string') {
    return Buffer.from(data, 'base64');
  }
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (typeof data === 'string') {
    return Buffer.from(data);
  }
  return Buffer.from(JSON.stringify(data));
}

export async function readRequestBuffer(req: {
  body?: unknown;
  buffer?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
}): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (Buffer.isBuffer(req.buffer)) {
    return req.buffer;
  }
  if (typeof req.body === 'object' && req.body) {
    return Buffer.from(JSON.stringify(req.body));
  }
  if (req.body) {
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function applyComposerPathMetadata(
  storagePath: string,
  pkg: WritablePackage,
): WritablePackage {
  if (!storagePath || storagePath === '/') {
    return pkg;
  }
  const parts = storagePath.split('/').filter((segment) => segment);
  if (parts.length < 3) {
    return pkg;
  }
  return {
    ...pkg,
    name: pkg.name || `${parts[0]}/${parts[1]}`,
    version: pkg.version || parts[2].replace('.zip', ''),
  };
}

export async function handleComposerGroupWrite(
  context: PluginContext,
  repo: Repository,
  pkg: WritablePackage,
  writeOperation: WriteOperation,
): Promise<WriteResult> {
  const groupConfig = (repo.config ?? {}) as ComposerGroupConfig;
  const writePolicy = groupConfig.writePolicy || 'none';
  const members = groupConfig.members || [];
  if (writePolicy === 'none') {
    return { ok: false, message: 'Group is read-only' };
  }

  const getHostedMembers = async () => {
    const hosted: Repository[] = [];
    if (!context.getRepo) {
      return hosted;
    }
    for (const id of members) {
      const member = await context.getRepo(id);
      if (member && member.type === 'hosted') {
        hosted.push(member);
      }
    }
    return hosted;
  };

  if (writePolicy === 'first') {
    const hosted = await getHostedMembers();
    for (const member of hosted) {
      const result = await writeOperation(member, pkg);
      if (result.ok) {
        return result;
      }
    }
    return { ok: false, message: 'No writable member found' };
  }

  if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
    const preferredId = groupConfig.preferredWriter;
    if (!preferredId) {
      return { ok: false, message: 'Preferred writer not configured' };
    }
    const member = await context.getRepo?.(preferredId);
    if (!member || member.type !== 'hosted') {
      return { ok: false, message: 'Preferred writer unavailable' };
    }
    return writeOperation(member, pkg);
  }

  if (writePolicy === 'mirror') {
    const hosted = await getHostedMembers();
    if (hosted.length === 0) {
      return { ok: false, message: 'No hosted members' };
    }
    const results = await Promise.all(
      hosted.map((member) => writeOperation(member, pkg)),
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
