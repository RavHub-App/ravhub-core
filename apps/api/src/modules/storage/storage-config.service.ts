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

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageConfig } from '../../entities/storage-config.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import { Backup } from '../../entities/backup.entity';
import { AuditService } from '../audit/audit.service';
import { LicenseService } from '../license/license.service';
import { StorageService } from './storage.service';

@Injectable()
export class StorageConfigService {
  private readonly logger = new Logger(StorageConfigService.name);

  constructor(
    @InjectRepository(StorageConfig)
    private readonly repo: Repository<StorageConfig>,
    @InjectRepository(RepositoryEntity)
    private readonly repositoryRepo: Repository<RepositoryEntity>,
    @InjectRepository(Artifact)
    private readonly artifactRepo: Repository<Artifact>,
    @InjectRepository(Backup)
    private readonly backupRepo: Repository<Backup>,
    private readonly auditService: AuditService,
    private readonly licenseService: LicenseService,
    private readonly storageService: StorageService,
  ) { }

  async list() {
    return this.repo.find();
  }

  async get(id: string) {
    return this.repo.findOneBy({ id });
  }

  async create(data: Partial<StorageConfig>) {
    // Check license for enterprise storage types
    if (data.type && ['s3', 'gcs', 'azure'].includes(data.type)) {
      const hasLicense = await this.licenseService.hasActiveLicense();
      if (!hasLicense) {
        throw new ForbiddenException(
          'Enterprise storage types (S3, GCS, Azure) require an active license',
        );
      }
    }

    const ent = this.repo.create(data as any);
    const saved = await this.repo.save(ent as any);

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'storage-config.create',
        entityType: 'storage-config',
        entityId: saved.id,
        details: { key: saved.key, type: saved.type },
      })
      .catch(() => { });

    return saved;
  }

  async update(id: string, data: Partial<StorageConfig>) {
    const ent = await this.repo.findOneBy({ id });
    if (!ent) return null;
    Object.assign(ent, data);
    const saved = await this.repo.save(ent as any);

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'storage-config.update',
        entityType: 'storage-config',
        entityId: id,
        details: { key: saved.key, changedFields: Object.keys(data) },
      })
      .catch(() => { });

    return saved;
  }

  async delete(id: string) {
    const config = await this.repo.findOneBy({ id });
    await this.repo.delete({ id });

    // Log audit event
    if (config) {
      await this.auditService
        .logSuccess({
          action: 'storage-config.delete',
          entityType: 'storage-config',
          entityId: id,
          details: { key: config.key },
        })
        .catch(() => { });
    }

    return { ok: true };
  }

  async listWithStats() {
    try {
      const configs = await this.repo.find();

      const [allRepos, allBackups] = await Promise.all([
        this.repositoryRepo.find().catch((err) => {
          this.logger.error('Failed to fetch repositories for stats', err);
          return [];
        }),
        this.backupRepo.find().catch((err) => {
          this.logger.error('Failed to fetch backups for stats', err);
          return [];
        }),
      ]);

      const configsWithStats = await Promise.all(
        configs.map(async (config) => {
          let count = 0;
          let totalSize = 0;

          try {
            if (config.usage === 'backup') {
              const backups = allBackups.filter(
                (b: any) => b.storageConfigId === config.id,
              );
              count = backups.length;
              totalSize = backups.reduce(
                (sum: number, b: any) => sum + (Number(b.sizeBytes) || 0),
                0,
              );
            } else {
              count = allRepos.filter(
                (repo: any) => repo.config?.storageId === config.id,
              ).length;

              const repoIds = allRepos
                .filter((repo: any) => repo.config?.storageId === config.id)
                .map((repo: any) => repo.id);

              if (repoIds.length > 0) {
                try {
                  const artifacts = await this.artifactRepo
                    .createQueryBuilder('artifact')
                    .where('artifact.repositoryId IN (:...repoIds)', { repoIds })
                    .getMany();

                  totalSize = artifacts.reduce((sum: number, artifact: any) => {
                    return sum + (Number(artifact.size) || 0);
                  }, 0);
                } catch (err) {
                  this.logger.error(
                    `Failed to calculate size for storage config ${config.id}`,
                    err,
                  );
                }
              }
            }
          } catch (err) {
            this.logger.error(
              `Failed to calculate stats for storage config ${config.id}`,
              err,
            );
          }

          return {
            ...config,
            stats: {
              repositoryCount: count,
              totalSize,
            },
          };
        }),
      );

      return configsWithStats;
    } catch (err) {
      this.logger.error('Failed to list storage configs with stats', err);
      throw err;
    }
  }
}
