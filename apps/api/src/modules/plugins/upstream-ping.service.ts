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
import AppDataSource from '../../data-source';

@Injectable()
export class UpstreamPingService {
  private readonly logger = new Logger(UpstreamPingService.name);
  private upstreamPingStatus: Map<
    string,
    { ts: number; ok: boolean; status?: number; message?: string }
  > = new Map();

  async pingUpstreamForRepo(repo: RepositoryEntity, pluginInstance: any) {
    if (!pluginInstance || typeof pluginInstance.pingUpstream !== 'function') {
      return { ok: false, message: 'Plugin does not support upstream ping' };
    }

    const upstreamUrl =
      repo.config?.target ||
      repo.config?.registry ||
      repo.config?.npm?.proxyUrl ||
      repo.config?.maven?.proxyUrl ||
      repo.config?.pypi?.proxyUrl ||
      repo.config?.docker?.proxyUrl;

    if (!upstreamUrl) {
      return { ok: false, message: 'No upstream URL configured' };
    }

    try {
      const result = await pluginInstance.pingUpstream(repo);
      const status = {
        ts: Date.now(),
        ok: result.ok,
        status: result.status,
        message: result.message,
      };

      this.upstreamPingStatus.set(repo.id, status);
      this.upstreamPingStatus.set(repo.name, status);

      this.logger.debug(
        `Upstream ping for ${repo.name}: ${result.ok ? 'OK' : 'FAILED'} (${result.status})`,
      );

      return result;
    } catch (err: any) {
      const status = {
        ts: Date.now(),
        ok: false,
        message: err.message,
      };

      this.upstreamPingStatus.set(repo.id, status);
      this.upstreamPingStatus.set(repo.name, status);

      this.logger.error(
        `Upstream ping failed for ${repo.name}: ${err.message}`,
      );
      return { ok: false, message: err.message };
    }
  }

  async getUpstreamPingStatus(idOrName: string) {
    const cached = this.upstreamPingStatus.get(idOrName);
    if (cached) return cached;

    if (!AppDataSource.isInitialized) return null;

    const repoRepo = AppDataSource.getRepository(RepositoryEntity);
    const repo = await repoRepo.findOne({
      where: [{ id: idOrName }, { name: idOrName }],
    });

    if (!repo) return null;

    return this.upstreamPingStatus.get(repo.id || repo.name) ?? null;
  }

  async triggerUpstreamPingForRepo(repo: any, pluginInstance: any) {
    if (!pluginInstance || typeof pluginInstance.pingUpstream !== 'function') {
      return { ok: false, message: 'Plugin does not support upstream ping' };
    }

    return this.pingUpstreamForRepo(repo, pluginInstance);
  }

  async startUpstreamPingScheduler(
    getPluginForRepo: (repo: RepositoryEntity) => any,
  ) {
    const intervalMs =
      parseInt(process.env.UPSTREAM_PING_INTERVAL_SECONDS || '300', 10) * 1000;

    const run = async () => {
      if (!AppDataSource.isInitialized) return;

      try {
        const repoRepo = AppDataSource.getRepository(RepositoryEntity);
        const proxies = await repoRepo.find({ where: { type: 'proxy' } });

        for (const repo of proxies) {
          try {
            const inst = getPluginForRepo(repo);
            if (inst) {
              await this.pingUpstreamForRepo(repo, inst);
            }
          } catch (err: any) {
            this.logger.debug(`Ping failed for ${repo.name}: ${err.message}`);
          }
        }
      } catch (err: any) {
        this.logger.warn(`Upstream ping scheduler error: ${err.message}`);
      }
    };

    await run();

    const interval = Math.max(60000, intervalMs);
    this.logger.log(
      `Starting upstream ping scheduler (interval ${interval / 1000}s)`,
    );
    setInterval(run, interval);
  }
}
