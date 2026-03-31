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
import {
  resolveManifestFileContentType,
  resolveManifestResponsePayload,
} from './manifest-read-body-support';

type ManifestReadResult = {
  ok?: boolean;
  versions?: string[];
  url?: string;
  data?: Buffer | string;
  body?: Buffer | string;
  metadata?: {
    digest?: string;
    groupId?: string;
    writePolicy?: string;
    targetRepoId?: string;
  };
};

type ManifestPlugin = {
  getBlob?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<ManifestReadResult | undefined>;
  download?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<ManifestReadResult | undefined>;
  trackDownload?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<void>;
};

type ManifestResponse = {
  statusCode: number;
  setHeader: (name: string, value: string | number | readonly string[]) => void;
  end: (chunk?: string | Buffer) => void;
};

export async function resolveManifestOrBlob(
  repo: Repository,
  reposById: Map<string, Repository> | undefined,
  plugin: ManifestPlugin,
  debug: (label: string, ...args: unknown[]) => void,
  name: string,
  tag: string,
): Promise<ManifestReadResult | undefined> {
  if ((repo?.type || '').toString().toLowerCase() !== 'group') {
    return fetchManifestFromRepository(plugin, repo, name, tag);
  }

  const members: string[] = repo.config?.members ?? [];
  debug(
    `[REGISTRY GROUP] manifest/blob GET for group ${repo.name}, members:`,
    members,
  );

  for (const memberId of members) {
    const childRepo = reposById?.get(memberId);
    if (!childRepo) {
      console.warn(
        `[REGISTRY GROUP] member ${memberId} not found in reposById`,
      );
      continue;
    }

    debug(`[REGISTRY GROUP] trying member ${childRepo.name} (${childRepo.id})`);
    const childResult = await fetchManifestFromRepository(
      plugin,
      childRepo,
      name,
      tag,
    );

    if (childResult?.ok) {
      debug(`[REGISTRY GROUP] resolved from member ${childRepo.name}`);
      return childResult;
    }
  }

  debug('[REGISTRY GROUP] not found in any member');
  return undefined;
}

export async function trackManifestDownload(
  plugin: ManifestPlugin,
  repo: Repository,
  name: string,
  tag: string,
  debug: (label: string, ...args: unknown[]) => void,
) {
  if (!plugin.trackDownload) {
    return;
  }

  try {
    await plugin.trackDownload(repo, name, tag);
    debug('[REGISTRY] Download tracked', { repoId: repo.id, name, tag });
  } catch (error) {
    console.error(
      '[REGISTRY] Failed to track download:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function respondManifestHead(
  res: ManifestResponse,
  result: ManifestReadResult,
  name: string,
  tag: string,
) {
  res.statusCode = 200;
  res.setHeader(
    'Content-Type',
    await resolveManifestContentType(result, name, tag),
  );
  res.end();
}

export async function respondManifestRead(
  res: ManifestResponse,
  result: ManifestReadResult,
  name: string,
  tag: string,
  chosenVersion: 'v2',
) {
  if (
    (result.url && result.url.startsWith('file://')) ||
    result.data ||
    result.body
  ) {
    return respondManifestBody(res, result, name, tag, chosenVersion);
  }

  if (result.url) {
    res.statusCode = 302;
    res.setHeader('Location', result.url);
    res.end();
    return;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(result));
}

async function fetchManifestFromRepository(
  plugin: ManifestPlugin,
  repo: Repository,
  name: string,
  tag: string,
) {
  return isDigestReference(tag)
    ? await plugin.getBlob?.(repo, name, tag)
    : await plugin.download?.(repo, name, tag);
}

function isDigestReference(tag: string) {
  return (
    tag.startsWith('sha256:') ||
    tag.startsWith('sha384:') ||
    tag.startsWith('sha512:')
  );
}

async function resolveManifestContentType(
  result: ManifestReadResult,
  name: string,
  tag: string,
) {
  return resolveManifestFileContentType(result, name, tag);
}

async function respondManifestBody(
  res: ManifestResponse,
  result: ManifestReadResult,
  name: string,
  tag: string,
  chosenVersion: 'v2',
) {
  try {
    const payload = await resolveManifestResponsePayload(
      result,
      name,
      tag,
      chosenVersion,
    );

    if (payload.digestHeader) {
      res.setHeader('Docker-Content-Digest', payload.digestHeader);
    }

    res.setHeader('Content-Type', payload.contentType);
    res.statusCode = 200;
    res.end(payload.responseBody);
  } catch (error) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, message: String(error) }));
  }
}
