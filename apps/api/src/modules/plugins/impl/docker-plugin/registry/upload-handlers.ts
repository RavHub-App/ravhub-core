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

import type { IncomingHttpHeaders } from 'node:http';
import {
  createUploadSessionId,
  ensurePushAccess,
  respondProxyWriteRejected,
  respondUploadAccepted,
  respondUploadCreated,
} from './upload-support';
import type { Repository } from '../utils/types';
import {
  isProxyRepository,
  isWritableUploadMethod,
  matchSingleStepUploadPath,
  matchUploadAppendPath,
  matchUploadFinalizePath,
  matchUploadInitiationPath,
  resolveFinalizeUploadBuffer,
  resolveUploadBuffer,
  resolveUploadDigest,
} from './upload-request-support';

type UploadRequest = {
  method?: string;
  headers: IncomingHttpHeaders;
};

type UploadResponse = {
  statusCode: number;
  setHeader: (name: string, value: string | number | readonly string[]) => void;
  end: (chunk?: string | Buffer) => void;
};

type UploadResult = {
  ok?: boolean;
  uuid?: string;
  id?: string;
  uploaded?: number;
  metadata?: {
    groupId?: string;
    writePolicy?: string;
    targetRepoId?: string;
  };
};

type UploadPlugin = {
  initiateUpload?: (
    repo: Repository,
    name: string,
  ) => Promise<UploadResult | undefined>;
  appendUpload?: (
    repo: Repository,
    uuid: string,
    _offset: undefined,
    buffer: Buffer | undefined,
  ) => Promise<UploadResult | undefined>;
  finalizeUpload?: (
    repo: Repository,
    name: string,
    uuid: string | undefined,
    digest: string | undefined,
    buffer: Buffer | undefined,
    _stream: undefined,
  ) => Promise<UploadResult | undefined>;
};

type UploadContext = {
  repo: Repository;
  plugin: UploadPlugin;
  req: UploadRequest;
  res: UploadResponse;
  parsed: { pathname?: string; query?: { digest?: string | string[] } };
  pathname: string;
  debug: (label: string, ...args: unknown[]) => void;
  chosenVersion: 'v2';
};

function fastAllowFromRoles(req: UploadRequest, forAction: 'push' | 'pull') {
  return false;
}

export async function handleUploadInitiation(
  context: unknown,
): Promise<boolean> {
  const uploadContext = context as UploadContext;
  const { repo, plugin, req, res, pathname, debug, chosenVersion } =
    uploadContext;
  const match = matchUploadInitiationPath(pathname, chosenVersion);

  if (!(match && req.method === 'POST')) return false;

  const name = decodeURIComponent(match[1]);
  if (isProxyRepository(repo)) {
    respondProxyWriteRejected(res);
    return true;
  }

  if (!ensurePushAccess(req, res, repo, name, pathname, debug)) {
    return true;
  }

  debug('[UPLOAD INIT] Calling initiateUpload for', name);
  const out = await plugin.initiateUpload?.(repo, name);
  debug('[UPLOAD INIT] Result:', out);
  if (out?.ok) {
    const uuid = createUploadSessionId(out);
    respondUploadAccepted(repo, res, name, uuid, undefined, true);
    return true;
  }

  console.error('[UPLOAD INIT] Failed, returning 500');
  res.statusCode = 500;
  res.end(JSON.stringify(out || { ok: false }));
  return true;
}

export async function handleBlobUploadAppend(
  context: unknown,
): Promise<boolean> {
  const uploadContext = context as UploadContext;
  const { repo, plugin, req, res, pathname, chosenVersion } = uploadContext;
  const match = matchUploadAppendPath(pathname, chosenVersion);

  if (!match) return false;

  if (isWritableUploadMethod(req)) {
    const name = decodeURIComponent(match[1]);
    if (!ensurePushAccess(req, res, repo, name, pathname)) {
      return true;
    }
  }

  if (!isWritableUploadMethod(req)) return false;

  const name = decodeURIComponent(match[1]);
  const uuid = match[2];
  const buffer = await resolveUploadBuffer(req, repo, name);
  const out = await plugin.appendUpload?.(repo, uuid, undefined, buffer);
  if (out?.ok) {
    respondUploadAccepted(repo, res, name, uuid, out.uploaded, false, out);
  } else {
    res.statusCode = 400;
    res.end(JSON.stringify(out || { ok: false }));
  }
  return true;
}

export async function handleBlobUploadFinalize(
  context: unknown,
): Promise<boolean> {
  const uploadContext = context as UploadContext;
  const { repo, plugin, req, res, parsed, pathname, chosenVersion } =
    uploadContext;
  const match = matchUploadFinalizePath(pathname, chosenVersion);

  if (match && req.method === 'PUT') {
    const name = decodeURIComponent(match[1]);
    if (!ensurePushAccess(req, res, repo, name, pathname)) {
      return true;
    }
  }

  if (!(req.method === 'PUT' && match)) return false;

  const name = decodeURIComponent(match[1]);
  if (isProxyRepository(repo)) {
    respondProxyWriteRejected(res);
    return true;
  }

  const uuid = match[2] ?? undefined;
  const digest = resolveUploadDigest(parsed.query?.digest);
  const buffer = await resolveFinalizeUploadBuffer(req, repo, name);

  const out = await plugin.finalizeUpload?.(
    repo,
    name,
    uuid,
    digest,
    buffer,
    undefined,
  );
  if (out?.ok) {
    respondUploadCreated(repo, res, name, out);
  } else {
    res.statusCode = 400;
    res.end(JSON.stringify(out || { ok: false }));
  }
  return true;
}

export async function handleSingleStepUploadInitiation(
  context: unknown,
): Promise<boolean> {
  const uploadContext = context as UploadContext;
  const { repo, plugin, req, res, parsed } = uploadContext;
  const match = matchSingleStepUploadPath(parsed.pathname);
  if (!(match && (req.method === 'POST' || req.method === 'PUT'))) return false;

  const name = decodeURIComponent(match[1]);
  const out = await plugin.initiateUpload?.(repo, name);
  if (out?.ok) {
    const uuid = createUploadSessionId(out);
    respondUploadAccepted(repo, res, name, uuid);
    return true;
  }
  res.statusCode = 500;
  res.end(JSON.stringify(out || { ok: false }));
  return true;
}
