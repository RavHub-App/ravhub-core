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

import type { Logger } from '@nestjs/common';
import AppDataSource from '../../data-source';
import { Artifact } from '../../entities/artifact.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { buildKey, normalizeStorageKey } from '../../storage/key-utils';
import type { AuditService } from '../audit/audit.service';

type PluginContextDependencies = {
  storage: unknown;
  redis: unknown;
  redlock: unknown;
  auditService: AuditService;
  logger: Logger;
};

type IndexedRepository = {
  id: string;
  name: string;
  manager?: string;
};

type ArtifactPayload = Record<string, unknown> & {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  metadata?: unknown;
};

type ArtifactMetadata = Record<string, unknown> & {
  name?: string;
  packageName?: string;
  version?: string;
  packageVersion?: string;
  storageKey?: string;
  path?: string;
  size?: number;
  contentHash?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function normalizeArtifactResult(result: unknown): ArtifactPayload {
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as ArtifactPayload;
    } catch {
      return { id: result };
    }
  }
  return (asRecord(result) ?? {}) as ArtifactPayload;
}

function normalizeArtifactMetadata(
  metadata: unknown,
  logger: Logger,
  repoName: string,
): ArtifactMetadata {
  if (typeof metadata === 'string') {
    try {
      return (JSON.parse(metadata) as ArtifactMetadata) ?? {};
    } catch (error) {
      logger.warn(
        `[PluginsService] Failed to parse artifact metadata for ${repoName}: ${String(error)}`,
      );
      return {};
    }
  }
  return (asRecord(metadata) ?? {}) as ArtifactMetadata;
}

function inferPackageIdentity(
  normalizedResult: ArtifactPayload,
  metadata: ArtifactMetadata,
) {
  let packageName =
    metadata.name ?? metadata.packageName ?? asString(normalizedResult.name);
  let packageVersion =
    metadata.version ??
    metadata.packageVersion ??
    asString(normalizedResult.version);

  const artifactId = asString(normalizedResult.id);
  if (!packageName && artifactId) {
    if (artifactId.includes('@') && !artifactId.startsWith('@')) {
      const parts = artifactId.split('@');
      packageName = parts[0];
      packageVersion = parts[1];
    } else if (artifactId.includes(':')) {
      const parts = artifactId.split(':');
      packageName = parts[0];
      packageVersion = parts[1];
    } else {
      packageName = artifactId;
    }
  }

  return { packageName, packageVersion, artifactId };
}

async function getRepoByIdOrName(id: string, logger: Logger) {
  if (!AppDataSource.isInitialized) {
    return null;
  }
  try {
    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      );
    let repo: RepositoryEntity | null = null;
    if (isUuid) {
      repo = await repoRepo.findOne({ where: { id } });
    }
    if (!repo) {
      repo = await repoRepo.findOne({ where: { name: id } });
    }
    return repo;
  } catch (error) {
    logger.error(
      `getRepo error: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
}

async function indexArtifactFromPluginContext(
  dependencies: PluginContextDependencies,
  repo: IndexedRepository,
  result: unknown,
  userId?: string,
  artifactPath?: string,
) {
  try {
    if (!AppDataSource.isInitialized) {
      return;
    }

    const artifactRepo = AppDataSource.getRepository(Artifact);
    const normalizedResult = normalizeArtifactResult(result);
    const metadata = normalizeArtifactMetadata(
      normalizedResult.metadata,
      dependencies.logger,
      repo.name,
    );
    const { packageName, packageVersion, artifactId } = inferPackageIdentity(
      normalizedResult,
      metadata,
    );

    if (!packageName) {
      return;
    }

    const storageKeyRaw = metadata.storageKey ?? artifactId ?? null;
    const storageKey = storageKeyRaw
      ? normalizeStorageKey(String(storageKeyRaw))
      : buildKey(repo.name, packageName || 'artifact');
    const finalPath =
      artifactPath ||
      metadata.path ||
      (artifactId && artifactId.includes('/') ? artifactId : null);
    const normalizedPath = finalPath ?? undefined;

    let artifact = await artifactRepo.findOne({
      where: {
        repositoryId: repo.id,
        packageName,
        version: packageVersion,
      },
    });

    if (artifact) {
      artifact.size = asNumber(metadata.size) ?? artifact.size;
      artifact.contentHash = metadata.contentHash ?? artifact.contentHash;
      artifact.metadata = metadata;
      artifact.storageKey = storageKey;
      artifact.packageName = packageName;
      artifact.version = packageVersion;
      artifact.path = normalizedPath || artifact.path;
      await artifactRepo.save(artifact);
    } else {
      artifact = artifactRepo.create({
        repository: repo as unknown as RepositoryEntity,
        repositoryId: repo.id,
        manager: repo.manager,
        packageName,
        version: packageVersion,
        storageKey,
        path: normalizedPath,
        size: asNumber(metadata.size),
        contentHash: metadata.contentHash,
        metadata,
        userId,
      } as unknown as Partial<Artifact>);
      await artifactRepo.save(artifact);
    }

    await dependencies.auditService.logSuccess({
      userId,
      action: 'artifact.index',
      entityType: 'artifact',
      entityId: artifact.id,
      details: {
        repositoryId: repo.id,
        repositoryName: repo.name,
        packageName: metadata.name,
        version: metadata.version,
        size: artifact.size,
        source: 'plugin-context',
      },
    });
  } catch (error) {
    dependencies.logger.error(
      `indexArtifact error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createPluginContext(dependencies: PluginContextDependencies) {
  return {
    storage: dependencies.storage,
    redis: dependencies.redis,
    redlock: dependencies.redlock,
    getRepo: async (id: string) => getRepoByIdOrName(id, dependencies.logger),
    indexArtifact: async (
      repo: IndexedRepository,
      result: unknown,
      userId?: string,
      artifactPath?: string,
    ) =>
      indexArtifactFromPluginContext(
        dependencies,
        repo,
        result,
        userId,
        artifactPath,
      ),
  };
}
