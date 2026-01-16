import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StorageConfig } from '../../entities/storage-config.entity';
import { AuditService } from '../audit/audit.service';
import { LicenseService } from '../license/license.service';
import { StorageService } from './storage.service';

@Injectable()
export class StorageConfigService {
  private readonly logger = new Logger(StorageConfigService.name);

  constructor(
    @InjectRepository(StorageConfig)
    private readonly repo: Repository<StorageConfig>,
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
    const configs = await this.repo.find();
    const AppDataSource = require('../../data-source').default;

    // Get all repositories to calculate stats
    const RepositoryEntity =
      require('../../entities/repository.entity').RepositoryEntity;
    const Artifact = require('../../entities/artifact.entity').Artifact;
    const Plugin = require('../../entities/plugin.entity').Plugin;
    const Backup = require('../../entities/backup.entity').Backup;

    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const artifactRepo = AppDataSource.getRepository(Artifact);
    const pluginRepo = AppDataSource.getRepository(Plugin);
    const backupRepo = AppDataSource.getRepository(Backup);

    const allRepos = await repoRepo.find();
    const allPlugins = await pluginRepo.find();
    const allBackups = await backupRepo.find();

    const configsWithStats = await Promise.all(
      configs.map(async (config) => {
        let count = 0;
        let totalSize = 0;

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
          // Repository usage (default)
          count = allRepos.filter(
            (repo: any) => repo.config?.storageId === config.id,
          ).length;

          const repoIds = allRepos
            .filter((repo: any) => repo.config?.storageId === config.id)
            .map((repo: any) => repo.id);

          if (repoIds.length > 0) {
            const artifacts = await artifactRepo
              .createQueryBuilder('artifact')
              .where('artifact.repositoryId IN (:...repoIds)', { repoIds })
              .getMany();

            totalSize = artifacts.reduce((sum: number, artifact: any) => {
              return sum + (Number(artifact.size) || 0);
            }, 0);
          }
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
  }
}
