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

import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import type { NugetStorageRequest, NugetUploadResult } from './storage-helpers';

type NugetStorage = PluginContext['storage'];

export function buildNugetPackageKeys(
  repo: Repository,
  name: string,
  version: string,
) {
  const fileName = `${name}.${version}.nupkg`;

  return {
    fileName,
    keyId: buildKey('nuget', repo.id, name, version, fileName),
    keyName: buildKey('nuget', repo.name, name, version, fileName),
  };
}

export async function ensureUploadRedeployAllowed(
  storage: NugetStorage,
  allowRedeploy: boolean,
  keyId: string,
  keyName: string,
  name: string,
  version: string,
) {
  if (allowRedeploy) {
    return null;
  }

  const existingId = await storage.get(keyId).catch(() => null);
  const existingName = await storage.get(keyName).catch(() => null);
  if (existingId || existingName) {
    return {
      ok: false,
      message: `Redeployment of ${name}:${version} is not allowed`,
    } satisfies NugetUploadResult;
  }

  return null;
}

export async function ensurePutRedeployAllowed(
  storage: NugetStorage,
  allowRedeploy: boolean,
  keyId: string,
  pkgName: string,
  pkgVersion: string,
) {
  if (allowRedeploy) {
    return null;
  }

  const exists = await storage.exists(keyId).catch(() => false);
  if (!exists) {
    return null;
  }

  return {
    ok: false,
    message: `Redeployment of ${pkgName}:${pkgVersion} is not allowed`,
  } satisfies NugetUploadResult;
}

export async function saveNugetUpload(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string,
  keyId: string,
  buffer: Buffer,
) {
  await context.storage.save(keyId, buffer);
  console.log(
    `[NuGetPlugin] Successfully uploaded package: ${name}:${version} to key: ${keyId}`,
  );

  const artifactResult = buildArtifactResult(
    name,
    version,
    keyId,
    buffer.length,
  );
  await indexNugetArtifact(
    context,
    repo,
    artifactResult,
    `[NuGetPlugin] Failed to index uploaded package ${name}:${version}`,
    'upload',
  );

  return artifactResult;
}

export async function saveNugetPut(
  context: PluginContext,
  repo: Repository,
  pkgName: string,
  pkgVersion: string,
  keyId: string,
  req: NugetStorageRequest,
  getBodyBuffer: (req: NugetStorageRequest) => Promise<Buffer>,
) {
  const result = await writeNugetPutPayload(
    context.storage,
    keyId,
    req,
    getBodyBuffer,
  );
  const artifactResult = buildArtifactResult(
    pkgName,
    pkgVersion,
    keyId,
    result.size,
    result.contentHash,
  );

  await indexNugetArtifact(
    context,
    repo,
    artifactResult,
    '[NuGetPlugin] Failed to index artifact:',
    'generic',
  );

  return artifactResult;
}

function buildArtifactResult(
  name: string,
  version: string,
  storageKey: string,
  size?: number,
  contentHash?: string,
) {
  return {
    ok: true,
    id: `${name}:${version}`,
    metadata: {
      name,
      version,
      storageKey,
      size,
      contentHash,
    },
  } satisfies NugetUploadResult;
}

async function writeNugetPutPayload(
  storage: NugetStorage,
  keyId: string,
  req: NugetStorageRequest,
  getBodyBuffer: (req: NugetStorageRequest) => Promise<Buffer>,
) {
  if (typeof storage.saveStream === 'function' && !req.body && !req.buffer) {
    return (await storage.saveStream(keyId, req)) as {
      ok: boolean;
      size?: number;
      contentHash?: string;
    };
  }

  const buffer = shouldReadEventedRequest(req)
    ? await readEventedRequestBuffer(req)
    : await getBodyBuffer(req);
  await storage.save(keyId, buffer);
  return { ok: true, size: buffer.length };
}

function shouldReadEventedRequest(req: NugetStorageRequest) {
  return typeof req.on === 'function' && !req.body && !req.buffer;
}

async function readEventedRequestBuffer(req: NugetStorageRequest) {
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    req.on?.('data', (chunk: unknown) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
    req.on?.('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on?.('error', (error: unknown) => {
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

async function indexNugetArtifact(
  context: PluginContext,
  repo: Repository,
  artifactResult: NugetUploadResult,
  messagePrefix: string,
  logMode: 'upload' | 'generic',
) {
  if (!context.indexArtifact) {
    return;
  }

  try {
    await context.indexArtifact(repo, artifactResult);
  } catch (error) {
    if (logMode === 'upload') {
      console.warn(`${messagePrefix}: ${String(error)}`);
      return;
    }

    console.error(messagePrefix, error);
  }
}
