import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Metric } from '../../entities/metric.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import AppDataSource from '../../data-source';

@Injectable()
export class MonitorService {
  constructor(@InjectRepository(Metric) private repo: Repository<Metric>) { }

  async getBasicMetrics() {
    // sample: compute simple metrics
    const recent = await this.repo.find({
      take: 5,
      order: { createdAt: 'DESC' },
    });
    return { uptime: process.uptime(), timestamp: Date.now(), recent };
  }

  async recordMetric(key: string, value: number) {
    const m = this.repo.create({ key, value });
    const saved = await this.repo.save(m);
    return saved;
  }

  async increment(key: string, by = 1) {
    const result = await this.recordMetric(key, by);
    return result;
  }

  async aggregate(keyPrefix?: string) {
    // simple aggregation (sum) grouped by key
    const qb = this.repo
      .createQueryBuilder('m')
      .select('m.key', 'key')
      .addSelect('SUM(m.value)::bigint', 'total')
      .groupBy('m.key');
    if (keyPrefix) qb.where('m.key LIKE :p', { p: `${keyPrefix}%` });
    const rows = await qb.getRawMany();
    return rows;
  }

  async getDetailedMetrics() {
    try {
      // Get aggregated metrics
      const allMetrics = await this.aggregate();

      // Calculate totals
      let totalUploads = 0;
      let totalDownloads = 0;
      let proxyCacheHits = 0;
      let proxyCacheMisses = 0;
      let proxyFetchSuccess = 0;
      let proxyFetchFailure = 0;
      let proxyFetchDurationTotal = 0;
      let proxyFetchErrors = 0;

      const uploadsByRepo: Record<string, number> = {};
      const downloadsByRepo: Record<string, number> = {};

      for (const metric of allMetrics) {
        const total = parseInt(String(metric.total || 0), 10);
        if (metric.key.startsWith('uploads.')) {
          totalUploads += total;
          const repoId = metric.key.replace('uploads.', '');
          uploadsByRepo[repoId] = total;
        } else if (metric.key.startsWith('downloads.')) {
          totalDownloads += total;
          const repoId = metric.key.replace('downloads.', '');
          downloadsByRepo[repoId] = total;
        } else if (metric.key === 'proxy_cache_hit') {
          proxyCacheHits = total;
        } else if (metric.key === 'proxy_cache_miss') {
          proxyCacheMisses = total;
        } else if (metric.key === 'proxy_fetch_success') {
          proxyFetchSuccess = total;
        } else if (metric.key === 'proxy_fetch_failure') {
          proxyFetchFailure = total;
        } else if (metric.key === 'proxy_fetch_duration_ms') {
          proxyFetchDurationTotal = total;
        } else if (metric.key === 'proxy_fetch_error') {
          proxyFetchErrors = total;
        }
      }

      // Get repository count and artifact counts (exclude groups)
      let repoCount = 0;
      let totalArtifacts = 0;
      const artifactsByRepo: Record<string, number> = {};
      const storageByRepo: Record<string, { size: number; count: number }> = {};

      if (AppDataSource?.isInitialized) {
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const artifactRepo = AppDataSource.getRepository(Artifact);

        // Count non-group repositories
        const allRepos = await repoRepo.find();
        const nonGroupRepos = allRepos.filter((r) => r.type !== 'group');
        repoCount = nonGroupRepos.length;

        // Count artifacts per repository (excluding groups)
        for (const repo of nonGroupRepos) {
          const count = await artifactRepo.count({
            where: { repositoryId: repo.id },
          });
          artifactsByRepo[repo.id] = count;
          totalArtifacts += count;
        }

        // Calculate storage per repository
        // This is an approximation based on artifact sizes
        for (const repo of nonGroupRepos) {
          const artifacts = await artifactRepo.find({
            where: { repositoryId: repo.id },
            select: ['size'],
          });
          // Convert bigint to number safely
          const totalSize = artifacts.reduce(
            (sum, a) => sum + parseInt(String(a.size || 0), 10),
            0,
          );
          storageByRepo[repo.id] = {
            size: totalSize,
            count: artifacts.length,
          };
        }
      }

      const totalStorage = Object.values(storageByRepo).reduce(
        (sum, s) => sum + s.size,
        0,
      );

      return {
        totalUploads,
        totalDownloads,
        totalArtifacts,
        totalStorage,
        repoCount,
        uploadsByRepo,
        downloadsByRepo,
        artifactsByRepo,
        storageByRepo,
        proxyMetrics: {
          hits: proxyCacheHits,
          misses: proxyCacheMisses,
          success: proxyFetchSuccess,
          failure: proxyFetchFailure,
          errors: proxyFetchErrors,
          durationTotal: proxyFetchDurationTotal
        }
      };
    } catch (err: any) {
      return {
        totalUploads: 0,
        totalDownloads: 0,
        totalArtifacts: 0,
        totalStorage: 0,
        repoCount: 0,
        uploadsByRepo: {},
        downloadsByRepo: {},
        artifactsByRepo: {},
        storageByRepo: {},
        proxyMetrics: { hits: 0, misses: 0, success: 0, failure: 0, errors: 0, durationTotal: 0 }
      };
    }
  }

  async getRecentArtifacts(limit: number = 10) {
    try {
      if (!AppDataSource?.isInitialized) {
        return [];
      }

      const artifactRepo = AppDataSource.getRepository(Artifact);
      const repoRepo = AppDataSource.getRepository(RepositoryEntity);

      const artifacts = await artifactRepo.find({
        take: limit,
        order: { createdAt: 'DESC' },
        relations: ['repository'],
      });

      return artifacts.map((a) => ({
        id: a.id,
        name: a.packageName,
        version: a.version,
        repository: {
          id: a.repository?.id,
          name: a.repository?.name,
          type: a.repository?.type,
          manager: a.repository?.manager || a.manager,
        },
        size: parseInt(String(a.size || 0), 10),
        createdAt: a.createdAt,
        lastAccessedAt: a.lastAccessedAt,
      }));
    } catch (err: any) {
      return [];
    }
  }
}
