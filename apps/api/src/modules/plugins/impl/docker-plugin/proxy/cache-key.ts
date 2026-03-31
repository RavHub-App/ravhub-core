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
import type { Repository } from '../utils/types';

export type ResolvedDockerProxyRequest = {
  key: string | null;
  pathStr: string;
  imgName: string | null;
  maniMatch: RegExpMatchArray | null;
};

export function resolveDockerProxyRequest(
  repo: Repository,
  urlStr: string,
): ResolvedDockerProxyRequest {
  const pathStr = new URL(urlStr).pathname || '';
  let key: string | null = null;
  const nameMatch = pathStr.match(/\/v2\/(.+?)\/(?:manifests|blobs)\//);
  const imgName = nameMatch ? decodeURIComponent(nameMatch[1]) : null;
  const tagsMatch = pathStr.match(/\/v2\/(.+?)\/tags\/list$/);
  const tagsImageName = tagsMatch ? decodeURIComponent(tagsMatch[1]) : null;
  const blobMatch = pathStr.match(/blobs\/(sha256:[A-Fa-f0-9:-]+)/i);

  if (blobMatch) {
    key = buildKey('docker', repo.id, 'blobs', blobMatch[1]);
  }

  const maniMatch = pathStr.match(/manifests\/(.+)$/);
  if (!key && maniMatch) {
    key = imgName
      ? buildKey('docker', repo.id, imgName, 'manifests', maniMatch[1])
      : buildKey('docker', repo.id, 'manifests', maniMatch[1]);
  }

  if (!key && tagsImageName) {
    key = buildKey('docker', repo.id, tagsImageName, 'tags', 'list');
  }

  return { key, pathStr, imgName, maniMatch };
}

export function getDockerCachedContentType(pathStr: string): string {
  if (pathStr.includes('/manifests/')) {
    return 'application/vnd.docker.distribution.manifest.v2+json';
  }

  if (pathStr.includes('/tags/list')) {
    return 'application/json';
  }

  return 'application/octet-stream';
}

export function isDigestReference(reference: string): boolean {
  return (
    reference.startsWith('sha256:') ||
    reference.startsWith('sha384:') ||
    reference.startsWith('sha512:')
  );
}
