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

import { buildKey } from './utils/key-utils';
import type { PluginContext, Repository } from './utils/types';

type RegistryStarter = (
  repo: Repository,
  opts: unknown,
  context: { plugin: unknown },
) => Promise<unknown>;

type PluginTokenRequest = {
  path?: string;
  query?: {
    scope?: string | string[];
    service?: string | string[];
  };
};

type DockerPluginLike = {
  id: string;
};

export function createRepoResolver(context: PluginContext) {
  const fallbackGetRepo = async (
    repoId: string,
  ): Promise<Repository | null> => {
    try {
      if (!context.storage?.get) {
        return null;
      }

      const key = buildKey('repository', repoId, 'metadata');
      const data = await context.storage.get(key);
      if (!data) {
        return null;
      }

      return JSON.parse(data.toString('utf8'));
    } catch (error) {
      console.error('[GET REPO ERROR]', error);
      return null;
    }
  };

  return async (repoId: string): Promise<Repository | null> => {
    const repo = context.getRepo
      ? await context.getRepo(repoId)
      : await fallbackGetRepo(repoId);
    return (repo as Repository | null) ?? null;
  };
}

export function createArtifactIndexer(context: PluginContext) {
  return async (
    repo: Repository,
    nameOrResult: string | { id?: string; metadata?: Record<string, unknown> },
    tagOrUserId?: string,
    metadata?: Record<string, unknown>,
    userId?: string,
  ) => {
    try {
      const resolved = resolveArtifactIndexArguments(
        repo,
        nameOrResult,
        tagOrUserId,
        metadata,
        userId,
      );
      const key = buildKey(
        'artifact',
        repo.id,
        'index',
        resolved.name,
        resolved.tag,
      );

      await context.storage.save(
        key,
        Buffer.from(
          JSON.stringify({
            name: resolved.name,
            tag: resolved.tag,
            repository: repo.name,
            repositoryId: repo.id,
            indexed: new Date().toISOString(),
            ...resolved.metadata,
          }),
        ),
      );

      if (context.indexArtifact) {
        await context.indexArtifact(
          repo,
          {
            ok: true,
            id: `${resolved.name}:${resolved.tag}`,
            metadata: {
              name: resolved.name,
              storageKey: key,
              ...resolved.metadata,
            },
          },
          resolved.userId,
        );
      }
    } catch (error) {
      console.error('[INDEX ARTIFACT ERROR]', error);
    }
  };
}

export function createDownloadTracker(context: PluginContext) {
  return async (repo: Repository, name: string, tag: string) => {
    try {
      if (context.trackDownload) {
        await context.trackDownload(repo, `${name}:${tag}`);
        return;
      }

      const key = buildKey('stats', repo.id, 'downloads', name, tag, Date.now().toString());
      await context.storage.save(
        key,
        Buffer.from(
          JSON.stringify({
            name,
            tag,
            repository: repo.name,
            repositoryId: repo.id,
            timestamp: new Date().toISOString(),
          }),
        ),
      );
    } catch (error) {
      console.error('[TRACK DOWNLOAD ERROR]', error);
    }
  };
}

export function createUploadTracker(context: PluginContext) {
  return async (repo: Repository, name: string, tag: string) => {
    try {
      await context.trackUpload?.(repo, `${name}:${tag}`);
    } catch (error) {
      console.error('[TRACK UPLOAD ERROR]', error);
    }
  };
}

export function createRegistryStarter(
  getRepo: (repoId: string) => Promise<Repository | null>,
  startRegistryForRepo: RegistryStarter,
) {
  return async (
    repo: Repository,
    plugin: DockerPluginLike,
    opts?: { reposById?: Map<string, Repository> },
  ) => {
    let nextOptions = opts;
    if (!opts?.reposById && repo.type === 'group') {
      const reposById = new Map<string, Repository>();
      const members: string[] = repo.config?.members ?? [];
      for (const memberId of members) {
        const memberRepo = await getRepo(memberId);
        if (memberRepo) {
          reposById.set(memberId, memberRepo);
        }
      }
      nextOptions = { ...opts, reposById };
    }

    return startRegistryForRepo(repo, nextOptions, { plugin });
  };
}

export function createTokenRequestHandler() {
  return async (_context: PluginContext, request: PluginTokenRequest) => {
    if (request.path !== '/v2/token') {
      return { status: 404, body: { error: 'Not found' } };
    }

    try {
      const jwt = require('jsonwebtoken');
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        console.error('[DOCKER PLUGIN] JWT_SECRET not configured');
        return { status: 500, body: { error: 'server misconfigured' } };
      }

      const service = getSingleQueryValue(request.query?.service);
      const scope = getSingleQueryValue(request.query?.scope);
      const token = jwt.sign(
        {
          iss: 'distributed-package-registry',
          sub: 'admin',
          aud: service,
          exp: Math.floor(Date.now() / 1000) + 3600,
          nbf: Math.floor(Date.now() / 1000) - 60,
          iat: Math.floor(Date.now() / 1000),
          jti: Math.random().toString(36).substring(2),
          access: buildTokenAccess(scope),
        },
        secret,
      );

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: { token },
      };
    } catch (error: any) {
      console.error('[DOCKER PLUGIN] Token generation failed:', error);
      return { status: 500, body: { error: error.message } };
    }
  };
}

function resolveArtifactIndexArguments(
  repo: Repository,
  nameOrResult: string | { id?: string; metadata?: Record<string, unknown> },
  tagOrUserId?: string,
  metadata?: Record<string, unknown>,
  userId?: string,
) {
  if (typeof nameOrResult === 'string') {
    return {
      name: nameOrResult,
      tag: tagOrUserId || 'latest',
      metadata: metadata || {},
      userId,
      repo,
    };
  }

  const result = nameOrResult;
  const resolvedMetadata = result.metadata || {};
  return {
    name: String(
      resolvedMetadata.name || result.id?.split(':')[0] || 'unknown',
    ),
    tag: String(
      resolvedMetadata.version || result.id?.split(':')[1] || 'latest',
    ),
    metadata: resolvedMetadata,
    userId: tagOrUserId,
    repo,
  };
}

function buildTokenAccess(scope?: string) {
  if (!scope) {
    return [];
  }

  const parts = scope.split(':');
  if (parts.length !== 3 || parts[0] !== 'repository') {
    return [];
  }

  return [
    {
      type: 'repository',
      name: parts[1],
      actions: parts[2].split(','),
    },
  ];
}

function getSingleQueryValue(value?: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}
