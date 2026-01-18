/*
 * Copyright (C) 2026 RavHub Team
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

import { Injectable, Logger } from '@nestjs/common';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import AppDataSource from '../../data-source';

@Injectable()
export class ArtifactIndexService {
  private readonly logger = new Logger(ArtifactIndexService.name);
  private pendingArtifacts: Array<{ repo: any; result: any; userId?: string }> =
    [];

  async indexArtifact(
    repo: RepositoryEntity,
    result: any,
    userId?: string,
    artifactPath?: string,
  ) {
    if (!result?.metadata) {
      this.logger.debug('No metadata to index');
      return;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn('DB not ready, queuing artifact for later indexing');
      this.pendingArtifacts.push({ repo, result, userId });
      return;
    }

    try {
      const artifactRepo = AppDataSource.getRepository(Artifact);
      const meta = result.metadata;

      const manager = (repo.manager || 'generic').toLowerCase();
      const packageName = meta.packageName || meta.name || artifactPath;
      const version = meta.version || 'unknown';

      if (!packageName) {
        this.logger.warn('Cannot index artifact without package name');
        return;
      }

      const existing = await artifactRepo.findOne({
        where: {
          repositoryId: repo.id,
          packageName,
          version,
        },
      });

      if (existing) {
        existing.size = meta.size || existing.size;
        existing.contentHash = meta.contentHash || existing.contentHash;
        existing.lastAccessedAt = new Date();

        if (meta.metadata) {
          existing.metadata = {
            ...(existing.metadata || {}),
            ...meta.metadata,
          };
        }

        await artifactRepo.save(existing);
        this.logger.debug(`Updated artifact index: ${packageName}@${version}`);
      } else {
        const artifact = artifactRepo.create({
          repositoryId: repo.id,
          packageName,
          version,
          size: meta.size || 0,
          contentHash: meta.contentHash,
          storageKey: meta.storageKey || artifactPath,
          metadata: meta.metadata || {},
        } as any);

        await artifactRepo.save(artifact);
        this.logger.log(`Indexed new artifact: ${packageName}@${version}`);
      }
    } catch (err: any) {
      this.logger.error(`Failed to index artifact: ${err.message}`);
    }
  }

  async flushPendingArtifacts() {
    if (!AppDataSource.isInitialized || this.pendingArtifacts.length === 0) {
      return;
    }

    this.logger.log(
      `Flushing ${this.pendingArtifacts.length} pending artifacts`,
    );

    const toProcess = [...this.pendingArtifacts];
    this.pendingArtifacts = [];

    for (const { repo, result, userId } of toProcess) {
      await this.indexArtifact(repo, result, userId);
    }
  }
}
