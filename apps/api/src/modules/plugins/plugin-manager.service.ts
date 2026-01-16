import { Injectable, Logger, OnModuleInit, UnauthorizedException, Inject, forwardRef } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { MonitorService } from '../monitor/monitor.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { RedisService } from '../redis/redis.service';
import { RedlockService } from '../redis/redlock.service';
import { RepositoryEntity } from '../../entities/repository.entity';
import AppDataSource from '../../data-source';
import { Artifact } from '../../entities/artifact.entity';
import { LicenseService } from '../license/license.service';

@Injectable()
export class PluginManagerService implements OnModuleInit {
  private readonly logger = new Logger(PluginManagerService.name);

  // Fallback in-memory cache for standalone mode
  private proxyCache: Map<string, { ts: number; payload: any }> = new Map();
  private upstreamPingStatus: Map<
    string,
    { ts: number; ok: boolean; status?: number; message?: string }
  > = new Map();

  // queue pending artifact indexing operations in case the DB wasn't ready
  private pendingArtifacts: Array<{ repo: any; result: any; userId?: string }> =
    [];

  constructor(
    private readonly plugins: PluginsService,
    private readonly monitor: MonitorService,
    private readonly auditService: AuditService,
    private readonly storage: StorageService,
    private readonly redis: RedisService,
    private readonly redlock: RedlockService,
    @Inject(forwardRef(() => LicenseService))
    private readonly licenseService: LicenseService,
  ) { }

  // Start scheduler when service constructed (deferred slightly to allow DB/plugin init)
  async onModuleInitSchedulerStarter() {
    // Wait a short time so other services are ready
    setTimeout(() => this.startUpstreamPingScheduler().catch(() => { }), 1000);
    setTimeout(
      () => this.startProxyCacheCleanupScheduler().catch(() => { }),
      2000,
    );
  }

  async onModuleInit() {
    // start the schedulers after module init
    await this.onModuleInitSchedulerStarter();
    // start job processor for proxy cache cleanup
    setTimeout(() => this.startJobProcessor().catch(() => { }), 3000);
  }

  /**
   * Process proxy cache cleanup jobs
   */
  private async startJobProcessor() {
    // Wait for DB to be ready
    let waited = 0;
    while (!AppDataSource.isInitialized && waited < 60) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waited += 1;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn('Job processor: DB not ready, skipping');
      return;
    }

    const { Job } = require('../../entities/job.entity');
    const jobRepo = AppDataSource.getRepository(Job);

    this.logger.log('Starting proxy cache cleanup job processor');

    // Process jobs every 30 seconds
    setInterval(async () => {
      try {
        // Use SELECT FOR UPDATE SKIP LOCKED for atomic job acquisition
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let job;
        try {
          // Use raw SQL for SELECT FOR UPDATE SKIP LOCKED
          const jobs = await queryRunner.query(
            `SELECT * FROM jobs
             WHERE type = $1
             AND status = $2
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            ['proxy-cache-cleanup', 'pending'],
          );

          job = jobs[0];

          if (!job) {
            await queryRunner.rollbackTransaction();
            return;
          }

          // Update job status atomically in same transaction
          await queryRunner.query(
            `UPDATE jobs SET 
              status = $1, 
              started_at = $2, 
              attempts = attempts + 1
            WHERE id = $3`,
            ['running', new Date(), job.id],
          );
          await queryRunner.commitTransaction();
        } catch (err) {
          await queryRunner.rollbackTransaction();
          return;
        } finally {
          await queryRunner.release();
        }

        // Execute cleanup
        try {
          const result = await this.executeProxyCacheCleanup();

          // Mark as completed
          await jobRepo.update(job.id, {
            status: 'completed' as any,
            completedAt: new Date(),
            result,
          });

          this.logger.log(
            `Proxy cache cleanup job ${job.id} completed: ${result.total} files deleted`,
          );
        } catch (err: any) {
          // Mark as failed
          await jobRepo.update(job.id, {
            status: 'failed' as any,
            completedAt: new Date(),
            error: err.message,
          });

          this.logger.error(
            `Proxy cache cleanup job ${job.id} failed: ${err.message}`,
          );
        }
      } catch (err: any) {
        this.logger.error(`Job processor error: ${err.message}`);
      }
    }, 30 * 1000);
  }

  // Start periodic ping scheduler for proxy repositories
  private async startUpstreamPingScheduler() {
    const intervalSec = parseInt(
      process.env.UPSTREAM_PING_INTERVAL_SECONDS || '300',
      10,
    ); // default 5 minutes

    const run = async () => {
      try {
        if (!AppDataSource.isInitialized) return;
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const proxies = await repoRepo.find({ where: { type: 'proxy' } });
        await Promise.all(
          proxies.map((r) =>
            this.pingUpstreamForRepo(r as any).catch(() => { }),
          ),
        );
      } catch (e: any) {
        this.logger.debug('Upstream ping scheduler error: ' + String(e));
      }
    };

    // Wait for DB to be ready (but don't block forever) then run immediately
    const maxWaitSec = 60; // give DB up to 60 seconds to initialize
    let waited = 0;
    while (!AppDataSource.isInitialized && waited < maxWaitSec) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waited += 1;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn(
        'Upstream ping scheduler: AppDataSource not ready after wait; scheduling will continue but initial run skipped',
      );
    } else {
      // execute an immediate run after DB is ready
      try {
        await run();
      } catch (err) {
        this.logger.debug('initial upstream ping run failed: ' + String(err));
      }
    }

    // schedule periodic runs (minimum 30s)
    const interval = Math.max(30, intervalSec) * 1000;
    this.logger.log(
      `Starting upstream ping scheduler (interval ${interval / 1000}s)`,
    );
    setInterval(run, interval);
  }

  // Start periodic cache cleanup scheduler for proxy repositories using jobs
  // Uses leader election to prevent duplicate job creation
  private async startProxyCacheCleanupScheduler() {
    // Default cleanup interval: run every hour
    const intervalSec = parseInt(
      process.env.PROXY_CACHE_CLEANUP_INTERVAL_SECONDS || '3600',
      10,
    );

    // Wait for DB to be ready
    const maxWaitSec = 60;
    let waited = 0;
    while (!AppDataSource.isInitialized && waited < maxWaitSec) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waited += 1;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn(
        'Proxy cache cleanup scheduler: DB not ready, skipping scheduler',
      );
      return;
    }

    const { Job } = require('../../entities/job.entity');
    const jobRepo = AppDataSource.getRepository(Job);

    // Leader election function using advisory lock
    const tryBecomeLeaderAndCreateJob = async () => {
      const SCHEDULER_LOCK_KEY = 999999; // Fixed key for scheduler leader election
      const queryRunner = AppDataSource.createQueryRunner();

      try {
        await queryRunner.connect();

        // Try to acquire advisory lock (non-blocking)
        const lockResult = await queryRunner.query(
          'SELECT pg_try_advisory_lock($1) as locked',
          [SCHEDULER_LOCK_KEY],
        );

        if (!lockResult[0]?.locked) {
          // Another instance is the leader
          return;
        }

        // We're the leader - check if job needs to be created
        const existingJob = await jobRepo.findOne({
          where: {
            type: 'proxy-cache-cleanup' as any,
            status: 'pending' as any,
          },
        });

        if (!existingJob) {
          await jobRepo.save(
            jobRepo.create({
              type: 'proxy-cache-cleanup' as any,
              status: 'pending' as any,
              payload: {},
              maxAttempts: 3,
            }),
          );
          this.logger.log('Leader created proxy cache cleanup job');
        }

        // Release lock
        await queryRunner.query('SELECT pg_advisory_unlock($1)', [
          SCHEDULER_LOCK_KEY,
        ]);
      } catch (err: any) {
        this.logger.warn(
          `Failed to create proxy cache cleanup job: ${err.message}`,
        );
      } finally {
        await queryRunner.release();
      }
    };

    // Create initial job
    await tryBecomeLeaderAndCreateJob();

    // Schedule periodic job creation (minimum 60s)
    const interval = Math.max(60, intervalSec) * 1000;
    this.logger.log(
      `Starting proxy cache cleanup job scheduler (interval ${interval / 1000}s)`,
    );

    setInterval(async () => {
      try {
        if (!AppDataSource.isInitialized) return;

        // Use leader election to create job
        await tryBecomeLeaderAndCreateJob();
      } catch (err: any) {
        this.logger.debug(
          `Failed to create proxy cache cleanup job: ${err.message}`,
        );
      }
    }, interval);
  }

  // Execute ping for a single repository and save status in Redis (or memory)
  private async pingUpstreamForRepo(repo: RepositoryEntity) {
    const key = repo.id || repo.name;
    const redisKey = `ravhub:upstream:status:${key}`;
    try {
      const inst = this.getPluginForRepo(repo);

      if (!inst || typeof (inst as any).pingUpstream !== 'function') {
        if (this.redis.isEnabled()) {
          await this.redis.getClient()?.del(redisKey);
        } else {
          this.upstreamPingStatus.delete(key);
        }
        return;
      }

      let result: any = null;
      try {
        result = await (inst as any).pingUpstream(repo, { timeoutMs: 3000 });
      } catch (err: any) {
        result = { ok: false, message: String(err) };
      }

      const status = {
        ts: Date.now(),
        ok:
          !!result?.ok ||
          (typeof result?.status === 'number' && result.status < 500),
        status: result?.status,
        message: result?.message ?? undefined,
      };

      if (this.redis.isEnabled()) {
        await this.redis.getClient()?.set(redisKey, JSON.stringify(status), 'EX', 3600); // 1 hour TTL
      } else {
        this.upstreamPingStatus.set(key, status);
      }
    } catch (err: any) {
      this.logger.warn(`Ping failed for ${key}: ${String(err)}`);
      const status = {
        ts: Date.now(),
        ok: false,
        message: String(err),
      };
      if (this.redis.isEnabled()) {
        await this.redis.getClient()?.set(redisKey, JSON.stringify(status), 'EX', 3600);
      } else {
        this.upstreamPingStatus.set(key, status);
      }
    }
  }

  // Public getter for upstream ping status
  public async getUpstreamPingStatus(idOrName: string) {
    if (this.redis.isEnabled()) {
      const redisKey = `ravhub:upstream:status:${idOrName}`;
      const data = await this.redis.getClient()?.get(redisKey);
      return data ? JSON.parse(data) : null;
    } else {
      return this.upstreamPingStatus.get(idOrName) ?? null;
    }
  }

  // Public trigger to perform an immediate ping for a given repository.
  // Returns the new status (or null if the attempt didn't populate one).
  public async triggerUpstreamPingForRepo(repo: any) {
    try {
      await this.pingUpstreamForRepo(repo);
      return await this.getUpstreamPingStatus(repo.id || repo.name);
    } catch (err: any) {
      this.logger.debug('triggerUpstreamPingForRepo error: ' + String(err));
      return (await this.getUpstreamPingStatus(repo.id || repo.name)) ?? null;
    }
  }

  /**
   * Clear cache entries for a specific repository
   * @param repoIdOrName Repository ID or name
   * @returns Number of cache entries cleared
   */
  public clearRepositoryCache(repoIdOrName: string): number {
    let cleared = 0;
    for (const [cacheKey] of this.proxyCache.entries()) {
      const repoIdentifier = cacheKey.split(':')[0];
      if (repoIdentifier === repoIdOrName) {
        this.proxyCache.delete(cacheKey);
        cleared++;
      }
    }
    if (cleared > 0) {
      this.logger.log(
        `Cleared ${cleared} cache entries for repository ${repoIdOrName}`,
      );
    }
    return cleared;
  }

  /**
   * Execute proxy cache cleanup for all proxy repositories
   * Called by job processor
   */
  public async executeProxyCacheCleanup(): Promise<{
    total: number;
    byRepo: Record<string, number>;
  }> {
    if (!AppDataSource.isInitialized) {
      throw new Error('Database not initialized');
    }

    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const proxies = await repoRepo.find({ where: { type: 'proxy' } });

    let total = 0;
    const byRepo: Record<string, number> = {};

    for (const repo of proxies) {
      try {
        const deleted = await this.cleanupProxyCache(repo.id);
        total += deleted;
        byRepo[repo.name] = deleted;
      } catch (err: any) {
        this.logger.warn(
          `Failed to cleanup cache for proxy ${repo.name}: ${err.message}`,
        );
        byRepo[repo.name] = 0;
      }
    }

    this.logger.log(
      `Proxy cache cleanup completed: ${total} files deleted across ${proxies.length} repositories`,
    );

    // Log audit event (async)
    this.auditService
      .logSuccess({
        action: 'proxy-cache.cleanup',
        entityType: 'proxy-cache',
        details: {
          totalDeleted: total,
          repositoriesProcessed: proxies.length,
          byRepository: byRepo,
        },
      })
      .catch(() => { });

    return { total, byRepo };
  }

  /**
   * Clean up old cached files from storage for a proxy repository
   * For Docker repos: only clean manifests, not blobs
   * For other repos: clean all cached files older than cacheMaxAgeDays
   */
  public async cleanupProxyCache(repoId: string): Promise<number> {
    if (!AppDataSource.isInitialized) return 0;

    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const repo = await repoRepo.findOne({ where: { id: repoId } });

    if (!repo || repo.type !== 'proxy') return 0;

    // Get cache max age in days from config (default: 7 days)
    const cacheEnabled = repo.config?.cacheEnabled !== false;
    const cacheMaxAgeDays = (repo.config?.cacheMaxAgeDays as number) ?? 7;

    // If cache is disabled, we should probably clean everything immediately or skip
    // but usually cleanup is for "old" files. If cacheEnabled is false, 
    // we'll treat it as if maxAge is 0 (clean everything).
    const effectiveMaxAgeDays = cacheEnabled ? cacheMaxAgeDays : 0;
    const maxAgeMs = effectiveMaxAgeDays * 24 * 60 * 60 * 1000;
    const cutoffDate = new Date(Date.now() - maxAgeMs);

    this.logger.debug(
      `Cleaning proxy cache for ${repo.name}: removing files older than ${effectiveMaxAgeDays} days (cacheEnabled: ${cacheEnabled})`,
    );

    const { buildKey } = require('../../storage/key-utils');
    const storage = this.storage;

    let deletedCount = 0;

    try {
      // Build prefix based on repository type/manager
      const manager = repo.manager || repo.config?.registry || 'npm';
      let prefix: string;

      if (manager === 'docker') {
        // For Docker: only clean manifests, NOT blobs
        // Blobs are cleaned by a separate task that checks for unreferenced layers
        prefix = buildKey('docker', repo.id, '');

        // List all files with this prefix
        const files = await storage.list(prefix);

        // Filter only manifest files and delete them
        for (const file of files) {
          // Only process manifest files (skip blobs)
          if (!file.includes('/manifests/') && !file.includes('proxy/')) {
            continue;
          }

          try {
            // Check metadata for age
            const meta = await storage.getMetadata(file);
            if (meta && meta.mtime > cutoffDate) {
              // File is still fresh, skip
              continue;
            }

            // For Docker manifests in proxy cache, delete all
            // (they will be re-fetched on demand from upstream)
            await storage.delete(file);
            deletedCount++;
          } catch (err: any) {
            this.logger.debug(`Failed to delete file ${file}: ${err.message}`);
          }
        }
      } else {
        // For other package types: clean all proxy cache files
        prefix = buildKey(manager, repo.id, 'proxy/');

        const files = await storage.list(prefix);

        for (const file of files) {
          try {
            // Check metadata for age
            const meta = await storage.getMetadata(file);
            if (meta && meta.mtime > cutoffDate) {
              // File is still fresh, skip
              continue;
            }

            // Delete all proxy cache files
            // (they will be re-fetched on demand from upstream)
            await storage.delete(file);
            deletedCount++;
          } catch (err: any) {
            this.logger.debug(`Failed to delete file ${file}: ${err.message}`);
          }
        }
      }

      if (deletedCount > 0) {
        this.logger.log(
          `Cleaned ${deletedCount} old cached files from proxy ${repo.name}`,
        );

        // Log audit event (async)
        this.auditService
          .logSuccess({
            action: 'proxy-cache.cleanup',
            entityType: 'repository',
            entityId: repo.id,
            details: {
              repositoryName: repo.name,
              repositoryType: repo.type,
              manager: manager,
              filesDeleted: deletedCount,
              cacheMaxAgeDays,
            },
          })
          .catch(() => { });
      }

      return deletedCount;
    } catch (err: any) {
      this.logger.warn(
        `Error cleaning proxy cache for ${repo.name}: ${err.message}`,
      );

      // Log audit event for failure (async)
      this.auditService
        .logFailure({
          action: 'proxy-cache.cleanup',
          entityType: 'repository',
          entityId: repo.id,
          details: {
            repositoryName: repo.name,
            repositoryType: repo.type,
            filesDeleted: deletedCount,
          },
          error: err.message,
        })
        .catch(() => { });

      return deletedCount;
    }
  }

  /**
   * Clear proxy cache entries for a specific repository
   * @returns Number of cache entries cleared
   */
  public async clearProxyCache(repoId: string): Promise<number> {
    let cleared = 0;

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:${repoId}:*`;

      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
    } else {
      const prefix = `${repoId}:`;
      for (const key of this.proxyCache.keys()) {
        if (key.startsWith(prefix)) {
          this.proxyCache.delete(key);
          cleared++;
        }
      }
    }

    if (cleared > 0) {
      this.logger.debug(
        `Cleared ${cleared} proxy cache entries for repository ${repoId}`,
      );
    }
    return cleared;
  }

  /**
   * Clear all proxy cache entries
   * @returns Number of cache entries cleared
   */
  public async clearAllProxyCache(): Promise<number> {
    let cleared = 0;

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:*`;

      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
    } else {
      cleared = this.proxyCache.size;
      this.proxyCache.clear();
    }

    if (cleared > 0) {
      this.logger.log(`Cleared all ${cleared} proxy cache entries`);
    }
    return cleared;
  }

  /**
   * Get cache statistics
   * @returns Object with cache statistics
   */
  public async getCacheStats() {
    const stats = {
      totalEntries: 0,
      byRepository: new Map<string, number>(),
    };

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:*`;

      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        for (const key of keys) {
          stats.totalEntries++;
          // Key format: ravhub:proxy:cache:repoId:url
          const parts = key.split(':');
          if (parts.length >= 4) {
            const repoId = parts[3];
            const count = stats.byRepository.get(repoId) || 0;
            stats.byRepository.set(repoId, count + 1);
          }
        }
      } while (cursor !== '0');
    } else {
      stats.totalEntries = this.proxyCache.size;
      for (const key of this.proxyCache.keys()) {
        const repoId = key.split(':')[0];
        const count = stats.byRepository.get(repoId) || 0;
        stats.byRepository.set(repoId, count + 1);
      }
    }

    return {
      totalEntries: stats.totalEntries,
      byRepository: Object.fromEntries(stats.byRepository),
    };
  }

  public getPluginForRepo(repo: RepositoryEntity) {
    // Determine plugin by repo.config.manager or repo.config.registry or repo.manager
    const manager = (repo as any).manager || repo.config?.registry || 'npm';

    // LICENSE CHECK: Ensure this feature is enabled
    if (!this.licenseService.isFeatureEnabled(manager)) {
      this.logger.warn(`Feature ${manager} requested for repository ${repo.name} but is disabled by license`);
      throw new UnauthorizedException(`Feature ${manager} is not enabled by your current license`);
    }

    const found = this.plugins.list().find((m) => m.key === manager);
    if (!found) {
      this.logger.debug(`no plugin loaded for manager ${manager}`);
      return null;
    }
    return this.plugins.getInstance(manager);
  }

  async handlePut(repo: RepositoryEntity, path: string, req: any, userId?: string) {
    if (repo.type !== 'hosted' && repo.type !== 'group') {
      throw new Error('PUT only supported for hosted and group repositories');
    }
    if (!repo.manager) {
      throw new Error('Repository manager not configured');
    }
    const plugin = this.plugins.getInstance(repo.manager);
    if (!plugin || typeof plugin.handlePut !== 'function') {
      throw new Error('Plugin does not support PUT');
    }

    const lockKey = `upload:repo:${repo.id}:path:${path}`;
    return this.redlock.runWithLock(lockKey, 30000, async () => {
      const result = await plugin.handlePut!(repo, path, req);

      // index artifact in DB (async fire-and-forget to optimize write latency)
      if (result?.ok && result?.metadata) {
        this.indexArtifact(repo, result, userId, path).catch((err) => {
          this.logger.warn(
            `failed to index artifact (async) after PUT: ${err.message}`,
          );
        });
      }

      return result;
    });
  }

  async upload(repo: RepositoryEntity, pkg: any, userId?: string) {
    // allow uploads to hosted and group repos
    if (repo.type !== 'hosted' && repo.type !== 'group')
      return {
        ok: false,
        message: 'upload only supported for hosted or group repositories',
      };

    const plugin = this.getPluginForRepo(repo);
    if (!plugin || typeof plugin.upload !== 'function')
      return { ok: false, message: 'unsupported' };

    // Try to determine a more specific lock key if possible
    let lockKey = `upload:repo:${repo.id}`;
    if (pkg?.name) {
      lockKey += `:pkg:${pkg.name}`;
      if (pkg?.version) {
        lockKey += `:v:${pkg.version}`;
      }
    }

    return this.redlock.runWithLock(lockKey, 30000, async () => {
      const result = await plugin.upload!(repo, pkg);
      try {
        // record an upload event metric
        await this.monitor.increment(`uploads.${repo.id || repo.name}`);
      } catch (err) {
        this.logger.debug('monitor increment failed ' + err.message);
      }

      // index artifact in DB (if plugin returned metadata or id)
      if (result?.ok) {
        // attempt immediate index; if DB not ready queue for retry
        try {
          await this.indexArtifact(repo, result, userId);
        } catch (err: any) {
          this.logger.debug('indexing deferred: ' + String(err));
          this.pendingArtifacts.push({ repo, result, userId });
          // schedule a background retry if not already scheduled
          if (this.pendingArtifacts.length === 1) {
            // try flush every few seconds until queue empty or max attempts
            const interval = setInterval(async () => {
              await this.flushPendingArtifacts();
              if (this.pendingArtifacts.length === 0) clearInterval(interval);
            }, 5_000);
          }
        }
      }
      return result;
    });
  }

  async download(
    repo: RepositoryEntity,
    name: string,
    version?: string,
    _visited: Set<string> = new Set(),
    userId?: string,
  ) {
    // handle group repository: iterate configured members until we find a match
    if (repo.type === 'group') {
      const members: string[] = repo.config?.members ?? [];
      if (!Array.isArray(members) || members.length === 0)
        return { ok: false, message: 'no members' };

      // prevent loops — track visited repo ids/names
      _visited.add(repo.id || repo.name);

      for (const m of members) {
        // try to resolve member repo by id or name
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const child =
          (await repoRepo.findOneBy({ id: m })) ??
          (await repoRepo.findOneBy({ name: m }));
        if (!child) continue;
        // skip if already visited
        if (_visited.has(child.id || child.name)) continue;

        const res = await this.download(child, name, version, _visited);
        if (res?.ok) return res;
      }
      return { ok: false, message: 'not found in group members' };
    }

    const plugin = this.getPluginForRepo(repo);
    if (!plugin) return { ok: false, message: 'plugin not found' };

    // If version looks like a digest (sha256:...), use getBlob instead of download
    const isDigest =
      version &&
      (version.startsWith('sha256:') ||
        version.startsWith('sha384:') ||
        version.startsWith('sha512:'));
    let result;
    if (isDigest && typeof plugin.getBlob === 'function') {
      result = await plugin.getBlob(repo, name, version);
    } else if (typeof plugin.download === 'function') {
      result = await plugin.download(repo, name, version);
    } else {
      return { ok: false, message: 'unsupported' };
    }

    try {
      // Update lastAccessedAt for the artifact
      if (result?.ok) {
        const downloadKey = `downloads.${repo.id || repo.name}`;
        await this.monitor.increment(downloadKey);

        if (AppDataSource?.isInitialized) {
          const artifactRepo = AppDataSource.getRepository(Artifact);
          await artifactRepo
            .createQueryBuilder()
            .update(Artifact)
            .set({ lastAccessedAt: new Date() })
            .where('repositoryId = :repoId', { repoId: repo.id })
            .andWhere('packageName = :name', { name })
            .andWhere(
              version ? 'version = :version' : '1=1',
              version ? { version } : {},
            )
            .execute();

          // Log audit event for artifact download (async)
          this.auditService
            .logSuccess({
              userId: userId,
              action: 'artifact.download',
              entityType: 'artifact',
              entityId: `${repo.id}:${name}:${version || 'latest'}`,
              details: {
                repositoryId: repo.id,
                repositoryName: repo.name,
                packageName: name,
                version: version || 'latest',
              },
            })
            .catch(() => { });
        }
      }
    } catch (err) {
      this.logger.warn('monitor increment failed ' + err.message);
    }
    return result;
  }

  async listVersions(
    repo: RepositoryEntity,
    name: string,
    _visited: Set<string> = new Set(),
  ) {
    // for group repos aggregate versions from members
    if (repo.type === 'group') {
      const members: string[] = repo.config?.members ?? [];
      if (!Array.isArray(members) || members.length === 0)
        return { ok: false, versions: [] };

      _visited.add(repo.id || repo.name);
      const allVersions = new Set<string>();
      for (const m of members) {
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const child =
          (await repoRepo.findOneBy({ id: m })) ??
          (await repoRepo.findOneBy({ name: m }));
        if (!child) continue;
        if (_visited.has(child.id || child.name)) continue;
        const res = await this.listVersions(child, name, _visited);
        if (res?.ok && Array.isArray(res.versions)) {
          res.versions.forEach((v) => allVersions.add(v));
        }
      }
      return { ok: true, versions: Array.from(allVersions).sort() };
    }

    const plugin = this.getPluginForRepo(repo);
    if (!plugin || typeof plugin.listVersions !== 'function')
      return { ok: false, versions: [] };

    const result = await plugin.listVersions(repo, name);

    // Merge with DB results to ensure consistency (especially for proxy repos where file might be missing but indexed)
    if (AppDataSource?.isInitialized) {
      try {
        const artifactRepo = AppDataSource.getRepository(Artifact);
        const dbArtifacts = await artifactRepo.find({
          where: { repositoryId: repo.id, packageName: name },
          select: ['version'],
        });

        if (dbArtifacts.length > 0) {
          const versions = new Set(result.versions || []);
          dbArtifacts.forEach((a) => {
            if (a.version) versions.add(a.version);
          });
          return {
            ...result,
            ok: true,
            versions: Array.from(versions).sort(),
          };
        }
      } catch (err) {
        this.logger.debug(`Failed to merge DB versions: ${err}`);
      }
    }

    return result;
  }

  async proxyFetch(repo: RepositoryEntity, url: string) {
    const start = Date.now();
    // proxy behavior: for proxy repos we implement a small TTL cache
    const isProxy = repo.type === 'proxy';
    const cacheKey = `${repo.id || repo.name}:${url}`;
    const redisKey = `ravhub:proxy:cache:${cacheKey}`;

    if (isProxy) {
      const ttl = (repo.config?.cacheTtlSeconds as number) ?? 60;
      let cached: any = null;

      if (this.redis.isEnabled()) {
        const cachedData = await this.redis.getClient()?.get(redisKey);
        if (cachedData) {
          cached = JSON.parse(cachedData);
        }
      } else {
        const inMem = this.proxyCache.get(cacheKey);
        if (inMem && Date.now() - inMem.ts < ttl * 1000) {
          cached = inMem;
        }
      }

      if (cached) {
        this.logger.debug(`proxy cache hit ${cacheKey}`);

        // Record cache hit metric
        this.monitor.increment('proxy_cache_hit');

        // Record download metric for proxy cache hit
        const downloadKey = `downloads.${repo.id || repo.name}`;
        this.monitor.increment(downloadKey);

        return cached.payload;
      }
      this.monitor.increment('proxy_cache_miss');
    }

    const plugin = this.getPluginForRepo(repo);
    if (!plugin || typeof plugin.proxyFetch !== 'function')
      return { ok: false, status: 404 };

    let result;
    try {
      result = await plugin.proxyFetch(repo, url);

      // Record success/failure metrics
      const duration = Date.now() - start;
      this.monitor.recordMetric('proxy_fetch_duration_ms', duration);

      if (result.ok) {
        this.monitor.increment('proxy_fetch_success');
        // Record download metric for proxy fetch success
        const downloadKey = `downloads.${repo.id || repo.name}`;
        this.monitor.increment(downloadKey);
      } else {
        this.monitor.increment('proxy_fetch_failure');
      }

      // Audit log for significant proxy actions (optional, maybe sample or only errors to avoid spam)
      // For now, we log failures or specific interesting events
      if (!result.ok || duration > 1000) {
        this.auditService.log({
          action: 'proxy_fetch',
          entityType: 'repository',
          entityId: repo.id,
          details: {
            repoName: repo.name,
            url,
            duration,
            status: result.status,
            ok: result.ok,
            error: result.message
          },
          status: result.ok ? 'success' : 'failure'
        }).catch(err => this.logger.error(`Failed to audit proxy fetch: ${err.message}`));
      }

    } catch (err) {
      const duration = Date.now() - start;
      this.monitor.increment('proxy_fetch_error');
      this.logger.error(`Proxy fetch error for ${repo.name}/${url}: ${err.message}`);

      this.auditService.log({
        action: 'proxy_fetch_error',
        entityType: 'repository',
        entityId: repo.id,
        details: {
          repoName: repo.name,
          url,
          duration,
          error: err.message
        },
        status: 'failure',
        error: err.message
      }).catch(e => { });

      return { ok: false, status: 500, message: err.message };
    }

    if (isProxy && result && result.ok && !result.skipCache && !result.stream) {
      const ttl = (repo.config?.cacheTtlSeconds as number) ?? 60;
      if (this.redis.isEnabled()) {
        await this.redis.getClient()?.set(
          redisKey,
          JSON.stringify({ ts: Date.now(), payload: result }),
          'EX',
          ttl
        );
      } else {
        this.proxyCache.set(cacheKey, { ts: Date.now(), payload: result });
      }
    }

    // If the plugin returned metadata (e.g. Maven proxy fetch), index it
    if (result && result.ok && (result as any).metadata) {
      try {
        await this.indexArtifact(repo, result);
      } catch (err) {
        this.logger.debug(`Failed to index proxy artifact: ${err.message}`);
      }
    }

    return result;
  }

  // Plugin-level auth (e.g. npm login, docker login)
  async authenticate(
    repo: RepositoryEntity,
    credentials: any,
    _visited: Set<string> = new Set(),
  ) {
    // support group: try members in order
    if (repo.type === 'group') {
      const members: string[] = repo.config?.members ?? [];
      if (!Array.isArray(members) || members.length === 0)
        return { ok: false, message: 'no members' };

      _visited.add(repo.id || repo.name);
      for (const m of members) {
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const child =
          (await repoRepo.findOneBy({ id: m })) ??
          (await repoRepo.findOneBy({ name: m }));
        if (!child) continue;
        if (_visited.has(child.id || child.name)) continue;
        const res = await this.authenticate(child, credentials, _visited);
        if (res?.ok) return res;
      }
      return { ok: false, message: 'not authenticated in group members' };
    }

    const plugin = this.getPluginForRepo(repo);
    if (!plugin || typeof plugin.authenticate !== 'function')
      return { ok: false, message: 'unsupported' };
    return plugin.authenticate(repo, credentials);
  }

  private async indexArtifact(
    repo: RepositoryEntity,
    result: any,
    userId?: string,
    artifactPath?: string,
  ) {
    if (!AppDataSource?.isInitialized)
      throw new Error('datasource-not-initialized');

    const artifactRepo = AppDataSource.getRepository(Artifact);

    // 1. Normalize result if it's a string (some plugins might send stringified JSON)
    let normalizedResult = result;
    if (typeof result === 'string') {
      try {
        normalizedResult = JSON.parse(result);
      } catch (e) {
        normalizedResult = { id: result };
      }
    }

    // 2. Extract metadata
    let metadata = normalizedResult.metadata ?? {};
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        // ignore
      }
    }

    // 3. Extract name/version
    let packageName =
      metadata.name || metadata.packageName || normalizedResult.name;
    let packageVersion =
      metadata.version || metadata.packageVersion || normalizedResult.version;

    // Determine path
    const finalPath = artifactPath || metadata.path || (normalizedResult.id && typeof normalizedResult.id === 'string' && normalizedResult.id.includes('/') ? normalizedResult.id : null);

    // 4. Fallback to ID parsing if name is missing
    if (
      !packageName &&
      normalizedResult.id &&
      typeof normalizedResult.id === 'string'
    ) {
      const id = normalizedResult.id;
      if (id.includes('@') && !id.startsWith('@')) {
        const parts = id.split('@');
        packageName = parts[0];
        packageVersion = parts[1];
      } else if (id.includes(':')) {
        const parts = id.split(':');
        packageName = parts[0];
        packageVersion = parts[1];
      } else {
        packageName = id;
      }
    }

    if (!packageName) {
      this.logger.debug(
        `Skipping indexing for artifact with no name: ${JSON.stringify(result)}`,
      );
      return;
    }

    const { buildKey } = require('../../storage/key-utils');
    const { normalizeStorageKey } = require('../../storage/key-utils');
    const storageKeyRaw = metadata.storageKey || normalizedResult.id || null;
    const storageKey = storageKeyRaw
      ? normalizeStorageKey(storageKeyRaw)
      : buildKey(repo.name, packageName || 'artifact');

    // Try to find existing artifact
    let art = await artifactRepo.findOne({
      where: {
        repositoryId: repo.id,
        packageName: packageName,
        version: packageVersion,
      },
    });

    if (art) {
      // Update existing artifact
      art.storageKey = storageKey;
      art.size = metadata.size ?? art.size; // Keep existing size if new one is undefined
      art.contentHash = metadata.contentHash ?? normalizedResult.contentHash ?? art.contentHash;
      art.metadata = metadata;
      art.manager = repo.manager;
      art.packageName = packageName; // Ensure name is updated if it was missing
      art.version = packageVersion; // Ensure version is updated
      art.path = finalPath || art.path;
    } else {
      // Create new artifact
      art = artifactRepo.create({
        repository: repo as any,
        repositoryId: repo.id,
        manager: repo.manager,
        packageName: packageName,
        version: packageVersion,
        storageKey,
        path: finalPath,
        size: metadata.size ?? undefined,
        contentHash: metadata.contentHash ?? normalizedResult.contentHash,
        metadata,
      });
    }

    await artifactRepo.save(art);

    // Log audit event for artifact upload/index (async)
    this.auditService
      .logSuccess({
        userId: userId,
        action: 'artifact.upload',
        entityType: 'artifact',
        entityId: art.id,
        details: {
          repositoryId: repo.id,
          repositoryName: repo.name,
          packageName: metadata.name,
          version: metadata.version,
          size: art.size,
        },
      })
      .catch(() => { });
  }

  private async flushPendingArtifacts() {
    if (!this.pendingArtifacts.length) return;
    if (!AppDataSource?.isInitialized) return; // still not ready

    const remaining: Array<{ repo: any; result: any }> = [];
    for (const item of this.pendingArtifacts) {
      try {
        await this.indexArtifact(item.repo, item.result, item.userId);
      } catch (err) {
        this.logger.debug('failed to flush artifact entry: ' + String(err));
        remaining.push(item);
      }
    }
    this.pendingArtifacts = remaining;
  }
}

// helper methods added outside the class body? Actually we must keep inside class. Ensure placement.
