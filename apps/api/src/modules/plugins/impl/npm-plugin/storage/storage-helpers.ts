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

import { runWithLock } from '../../../../../plugins-core/lock-helper';
import { buildKey } from '../utils/key-utils';
import {
  createInitialMetadata,
  mergeMetadata,
  NpmMetadata,
} from '../utils/metadata';
import type { PluginContext, Repository } from '../utils/types';

export async function streamToBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function saveNpmFile(
  storage: PluginContext['storage'],
  repo: Repository,
  path: string,
  data: Buffer,
) {
  const key = buildKey('npm', repo.id, path);
  return storage.save(key, data);
}

export async function saveNpmFileStream(
  storage: PluginContext['storage'],
  repo: Repository,
  path: string,
  stream: any,
) {
  const key = buildKey('npm', repo.id, path);
  if (typeof storage.saveStream === 'function') {
    return storage.saveStream(key, stream);
  }
  const buffer = await streamToBuffer(stream);
  return storage.save(key, buffer);
}

export async function getNpmFile(
  storage: PluginContext['storage'],
  repo: Repository,
  path: string,
) {
  const keyById = buildKey('npm', repo.id, path);
  const byId = await Promise.resolve(storage.get(keyById)).catch(() => null);
  if (byId) {
    return byId;
  }

  const keyByName = buildKey('npm', repo.name, path);
  return Promise.resolve(storage.get(keyByName)).catch(() => null);
}

export async function readNpmRequestBody(req: any): Promise<{
  buffer: Buffer;
  incoming?: NpmMetadata;
}> {
  if (
    req.body &&
    (Buffer.isBuffer(req.body) || Object.keys(req.body).length > 0)
  ) {
    if (Buffer.isBuffer(req.body)) {
      try {
        return {
          buffer: req.body,
          incoming: JSON.parse(req.body.toString('utf8')) as NpmMetadata,
        };
      } catch {
        return { buffer: req.body };
      }
    }

    if (typeof req.body === 'object') {
      return {
        incoming: req.body as NpmMetadata,
        buffer: Buffer.from(JSON.stringify(req.body)),
      };
    }

    return { buffer: Buffer.from(String(req.body)) };
  }

  const buffer = await streamToBuffer(req);
  try {
    return {
      buffer,
      incoming: JSON.parse(buffer.toString('utf8')) as NpmMetadata,
    };
  } catch {
    return { buffer };
  }
}

export async function updateNpmPackageMetadata(
  context: PluginContext,
  repo: Repository,
  metaPath: string,
  incoming: NpmMetadata,
): Promise<{
  metaResult: any;
  lastAttachmentResult: any;
  merged: NpmMetadata;
}> {
  const lockKey = `npm:${repo.id}:${metaPath}`;

  return runWithLock(context, lockKey, async () => {
    const currentBuffer = await getNpmFile(context.storage, repo, metaPath);
    let current: NpmMetadata | undefined;
    if (currentBuffer) {
      try {
        current = JSON.parse(currentBuffer.toString()) as NpmMetadata;
      } catch {
        current = undefined;
      }
    }

    const merged = mergeMetadata(
      current || createInitialMetadata(incoming.name),
      incoming,
    );

    let lastAttachmentResult: any;
    if (incoming._attachments) {
      for (const [filename, attachment] of Object.entries(
        incoming._attachments,
      )) {
        const attachmentData = Buffer.from(attachment.data, 'base64');
        const attachmentPath = `${merged.name}/-/${filename}`;
        lastAttachmentResult = await saveNpmFile(
          context.storage,
          repo,
          attachmentPath,
          attachmentData,
        );
      }
    }

    const metaResult = await saveNpmFile(
      context.storage,
      repo,
      metaPath,
      Buffer.from(JSON.stringify(merged, null, 2)),
    );

    return { metaResult, lastAttachmentResult, merged };
  });
}

export function getNpmMetadataPath(path: string) {
  return !path.includes('/-/') && !path.endsWith('.tgz')
    ? `${path}/package.json`
    : path;
}
