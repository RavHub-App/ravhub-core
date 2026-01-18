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
import { RedisService } from '../redis/redis.service';
import { StorageService } from '../storage/storage.service';
import { RepositoryEntity } from '../../entities/repository.entity';
import AppDataSource from '../../data-source';

@Injectable()
export class ProxyCacheService {
  private readonly logger = new Logger(ProxyCacheService.name);
  private proxyCache: Map<string, { ts: number; payload: any }> = new Map();

  constructor(
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async clearProxyCache(repoId: string): Promise<number> {
    let cleared = 0;

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:${repoId}:*`;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
          cleared += keys.length;
        }
      } while (cursor !== '0');
    } else {
      for (const key of this.proxyCache.keys()) {
        if (key.startsWith(`${repoId}:`)) {
          this.proxyCache.delete(key);
          cleared++;
        }
      }
    }

    this.logger.log(
      `Cleared ${cleared} proxy cache entries for repository ${repoId}`,
    );
    return cleared;
  }

  async clearAllProxyCache(): Promise<number> {
    let cleared = 0;

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:*`;
      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
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

    this.logger.log(`Cleared all ${cleared} proxy cache entries`);
    return cleared;
  }

  async getCacheStats() {
    const stats = {
      totalEntries: 0,
      byRepository: new Map<string, number>(),
    };

    if (this.redis.isEnabled()) {
      const client = this.redis.getClient()!;
      const pattern = `ravhub:proxy:cache:*`;

      let cursor = '0';
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        for (const key of keys) {
          stats.totalEntries++;
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

  async cleanupProxyCache(repoId: string): Promise<number> {
    if (!AppDataSource.isInitialized) return 0;

    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const repo = await repoRepo.findOne({ where: { id: repoId } });

    if (!repo || repo.type !== 'proxy') return 0;

    const cacheEnabled = repo.config?.cacheEnabled !== false;
    const cacheMaxAgeDays = (repo.config?.cacheMaxAgeDays as number) ?? 7;
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
      const manager = repo.manager || repo.config?.registry || 'npm';
      let prefix: string;

      if (manager === 'docker') {
        prefix = buildKey('docker', repo.id, '');
        const files = await storage.list(prefix);

        for (const file of files) {
          if (!file.includes('/manifests/') && !file.includes('proxy/')) {
            continue;
          }

          try {
            const meta = await storage.getMetadata(file);
            if (meta && meta.mtime > cutoffDate) {
              continue;
            }

            await storage.delete(file);
            deletedCount++;
          } catch (err: any) {
            this.logger.warn(`Failed to delete ${file}: ${err.message}`);
          }
        }
      } else {
        prefix = buildKey(manager, repo.name, '');
        const files = await storage.list(prefix);

        for (const file of files) {
          try {
            const meta = await storage.getMetadata(file);
            if (meta && meta.mtime > cutoffDate) {
              continue;
            }

            await storage.delete(file);
            deletedCount++;
          } catch (err: any) {
            this.logger.warn(`Failed to delete ${file}: ${err.message}`);
          }
        }
      }

      this.logger.log(
        `Cleaned ${deletedCount} cached files for proxy repository ${repo.name}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Failed to cleanup proxy cache for ${repo.name}: ${err.message}`,
      );
    }

    return deletedCount;
  }

  async executeProxyCacheCleanup(): Promise<{
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

    return { total, byRepo };
  }

  getCache(): Map<string, { ts: number; payload: any }> {
    return this.proxyCache;
  }
}
