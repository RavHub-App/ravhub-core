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

export type DockerImageEntry = {
  name: string;
  latestVersion?: string;
  updatedAt: string;
};

export type DockerArtifactEntry = {
  id: string;
  version: string;
  type: 'docker/image';
  name: string;
  createdAt: string;
  installCommand: string;
  size: number;
};

export type ListPackagesResult =
  | { ok: true; packages: DockerImageEntry[] }
  | { ok: false; message: string };

export type GetPackageResult =
  | { ok: true; name: string; artifacts: DockerArtifactEntry[] }
  | { ok: false; message: string };

export type ListVersionsResult =
  | { ok: true; versions: string[] }
  | { ok: false; message: string };

export type ProxyFetchResult = {
  ok?: boolean;
  body?: unknown;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRepository(value: unknown): value is Repository {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string'
  );
}

export function asRepository(value: unknown): Repository | null {
  return isRepository(value) ? value : null;
}

function parseStoredPayload(payload: unknown): unknown {
  if (Buffer.isBuffer(payload)) {
    return JSON.parse(payload.toString('utf8'));
  }

  if (typeof payload === 'string') {
    return JSON.parse(payload);
  }

  return payload;
}

export function parseDockerStoredPayload(payload: unknown): unknown {
  return parseStoredPayload(payload);
}

export function getStringTags(payload: unknown): string[] {
  try {
    const parsedPayload = parseStoredPayload(payload);
    if (!isRecord(parsedPayload) || !Array.isArray(parsedPayload.tags)) {
      return [];
    }

    return parsedPayload.tags.filter(
      (tag: unknown): tag is string => typeof tag === 'string',
    );
  } catch {
    return [];
  }
}

export function decodeTag(tag: string): string {
  try {
    return decodeURIComponent(tag);
  } catch {
    return tag;
  }
}

function getEntrySize(value: unknown): number {
  return isRecord(value) && typeof value.size === 'number' ? value.size : 0;
}

export function getManifestSize(payload: unknown): number {
  try {
    const parsedPayload = parseStoredPayload(payload);
    if (!isRecord(parsedPayload)) {
      return 0;
    }

    const manifests = Array.isArray(parsedPayload.manifests)
      ? parsedPayload.manifests
      : [];
    const layers = Array.isArray(parsedPayload.layers)
      ? parsedPayload.layers
      : [];
    const configSize = isRecord(parsedPayload.config)
      ? getEntrySize(parsedPayload.config)
      : 0;

    if (manifests.length > 0) {
      return (
        manifests.reduce(
          (acc: number, entry: unknown) => acc + getEntrySize(entry),
          0,
        ) + configSize
      );
    }

    return (
      layers.reduce(
        (acc: number, entry: unknown) => acc + getEntrySize(entry),
        0,
      ) + configSize
    );
  } catch {
    return 0;
  }
}

export function getRegistryHost(repo: Repository): string {
  const registry = repo.accessUrl || 'localhost:5000';
  return registry.replace(/^https?:\/\//, '');
}

export function isDigestTag(tag: string): boolean {
  return (
    tag.startsWith('sha256:') ||
    tag.startsWith('sha384:') ||
    tag.startsWith('sha512:')
  );
}
