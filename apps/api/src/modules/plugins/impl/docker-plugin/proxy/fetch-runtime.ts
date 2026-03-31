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

import type { Repository } from '../utils/types';
import { type DockerProxyFetchResponse } from './context';
import { type ResolvedDockerProxyRequest } from './cache-key';
import {
  fetchDockerUpstreamResponse,
  readDockerProxyBody,
} from './upstream-client';
import {
  buildDockerProxySuccessResponse,
  indexDockerManifestArtifact,
  saveDockerProxyPayload,
} from './fetch-runtime-support';

export async function performDockerProxyFetch(
  repo: Repository,
  urlStr: string,
  request: ResolvedDockerProxyRequest,
  headers: Record<string, string>,
): Promise<DockerProxyFetchResponse> {
  const response = await fetchDockerUpstreamResponse(repo, urlStr, headers);
  if (!response.ok) {
    return {
      ok: false,
      status: response.status || 500,
      body: response.body,
    };
  }

  const payload = await readDockerProxyBody(response);
  const cacheSaveError = await saveDockerProxyPayload(
    repo,
    request,
    payload,
    response.status,
  );
  if (cacheSaveError) {
    return cacheSaveError;
  }

  await indexDockerManifestArtifact(repo, request, request.key, payload);

  return buildDockerProxySuccessResponse(
    urlStr,
    request,
    response.status,
    payload,
  );
}
