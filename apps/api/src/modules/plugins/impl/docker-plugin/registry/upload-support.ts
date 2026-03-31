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
import { checkTokenAllows } from './auth';
import { buildPublicUrl, sendAuthChallenge } from './utils';
import type { Repository } from '../utils/types';

type UploadRequest = {
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

export function ensurePushAccess(
  req: UploadRequest,
  res: UploadResponse,
  repo: Repository,
  name: string,
  pathname: string,
  debug?: (label: string, ...args: unknown[]) => void,
) {
  if (!req.headers?.authorization) {
    if (!fastAllowFromRoles(req, 'push')) {
      sendAuthChallenge(res, name, 'push', 401, repo);
      return false;
    }
    return true;
  }

  const allowed = checkTokenAllows(req.headers.authorization, name, 'push');
  debug?.('[REGISTRY AUTH]', {
    path: pathname,
    name,
    hasAuth: !!req.headers?.authorization,
    authType: req.headers?.authorization?.split(' ')[0],
    allowed: allowed.allowed,
    reason: allowed.reason,
  });

  if (!allowed.allowed) {
    sendAuthChallenge(res, name, 'push', 403, repo);
    return false;
  }

  return true;
}

export function parseLegacyUploadBuffer(
  repositoryName: string,
  packageName: string,
  buffer: Buffer | undefined,
) {
  if (!buffer) {
    return undefined;
  }

  try {
    const text = buffer.toString('utf8');
    if (/^{/.test(text)) {
      const parsedJson = JSON.parse(text || '{}') as { data?: string };
      if (parsedJson.data) {
        return Buffer.from(parsedJson.data, 'base64');
      }
    }
  } catch (error) {
    console.warn(
      `[DOCKER REGISTRY] Failed to parse legacy upload payload for ${repositoryName}/${packageName}: ${String(error)}`,
    );
  }

  return buffer;
}

export function createUploadSessionId(result?: UploadResult) {
  return (
    result?.uuid ??
    result?.id ??
    `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
}

export function respondUploadAccepted(
  repo: Repository,
  res: UploadResponse,
  name: string,
  uuid: string,
  uploaded?: number,
  includeDockerUuid?: boolean,
  payload?: unknown,
) {
  res.setHeader(
    'Location',
    buildPublicUrl(
      repo,
      `/v2/${encodeURIComponent(name)}/blobs/uploads/${uuid}`,
      res,
    ),
  );
  if (includeDockerUuid) {
    res.setHeader('Docker-Upload-UUID', uuid);
  }
  if (typeof uploaded === 'number' && uploaded > 0) {
    res.setHeader('Range', `0-${uploaded - 1}`);
  }
  res.statusCode = 202;
  res.end(JSON.stringify(payload ?? { ok: true, uuid }));
}

export function respondUploadCreated(
  repo: Repository,
  res: UploadResponse,
  name: string,
  result: UploadResult,
) {
  res.statusCode = 201;
  res.setHeader(
    'Location',
    buildPublicUrl(
      repo,
      `/v2/${encodeURIComponent(name)}/blobs/${result.id}`,
      res,
    ),
  );
  if (result.metadata?.groupId) {
    res.setHeader('X-Group-Id', result.metadata.groupId);
  }
  if (result.metadata?.writePolicy) {
    res.setHeader('X-Write-Policy', result.metadata.writePolicy);
  }
  if (result.metadata?.targetRepoId) {
    res.setHeader('X-Write-Target', result.metadata.targetRepoId);
  }
  res.end(JSON.stringify(result));
}

export function respondProxyWriteRejected(res: UploadResponse) {
  res.statusCode = 405;
  res.end(
    JSON.stringify({
      ok: false,
      message: 'push not allowed on proxy repository',
    }),
  );
}

function fastAllowFromRoles(req: UploadRequest, forAction: 'push' | 'pull') {
  const rolesHeader = req.headers['x-user-roles'] || req.headers['x-user-role'];
  if (!rolesHeader) {
    return false;
  }

  const roles = String(rolesHeader)
    .split(',')
    .map((role: string) => role.trim().toLowerCase());

  if (forAction === 'pull') {
    return (
      roles.includes('reader') ||
      roles.includes('admin') ||
      roles.includes('user')
    );
  }

  return (
    roles.includes('admin') ||
    roles.includes('writer') ||
    roles.includes('manager')
  );
}
