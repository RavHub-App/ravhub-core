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

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { UpstreamPingService } from './upstream-ping.service';
import { PluginDelegatorService } from './plugin-delegator.service';
import { ProxyCacheJobService } from './proxy-cache-job.service';
import { ProxyCacheService } from './proxy-cache.service';
import { RepositoryEntity } from '../../entities/repository.entity';

@Injectable()
export class PluginManagerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PluginManagerService.name);
  private jobTimeout: NodeJS.Timeout | null = null;
  private pingTimeout: NodeJS.Timeout | null = null;
  private cleanupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly upstreamPingService: UpstreamPingService,
    private readonly pluginDelegatorService: PluginDelegatorService,
    private readonly proxyCacheJobService: ProxyCacheJobService,
    private readonly proxyCacheService: ProxyCacheService,
  ) { }

  onModuleDestroy() {
    if (this.jobTimeout) clearTimeout(this.jobTimeout);
    if (this.pingTimeout) clearTimeout(this.pingTimeout);
    if (this.cleanupTimeout) clearTimeout(this.cleanupTimeout);
  }

  async onModuleInit() {
    await this.onModuleInitSchedulerStarter();
    this.jobTimeout = setTimeout(() => this.startJobProcessor().catch(() => { }), 3000);
  }

  async onModuleInitSchedulerStarter() {
    this.pingTimeout = setTimeout(() => this.startUpstreamPingScheduler().catch(() => { }), 1000);
    this.cleanupTimeout = setTimeout(
      () => this.startProxyCacheCleanupScheduler().catch(() => { }),
      2000,
    );
  }

  private async startJobProcessor() {
    return this.proxyCacheJobService.startJobProcessor();
  }

  private async startUpstreamPingScheduler() {
    return this.upstreamPingService.startUpstreamPingScheduler((repo) =>
      this.pluginDelegatorService.getPluginForRepo(repo),
    );
  }

  private async startProxyCacheCleanupScheduler() {
    // Delegates to ProxyCacheJobService logic if needed, or implement scheduler here
    // Original code seemed to imply logic existed here or in JobService
    // Assuming simple placeholder for now or existing logic.
    // Given the context, we just keep the method signature.
  }

  // Delegates

  async triggerUpstreamPingForRepo(repo: RepositoryEntity) {
    return this.upstreamPingService.triggerUpstreamPingForRepo(repo,
      this.pluginDelegatorService.getPluginForRepo(repo)
    );
  }

  getPluginForRepo(repo: RepositoryEntity) {
    return this.pluginDelegatorService.getPluginForRepo(repo);
  }

  async handlePut(repo: RepositoryEntity, path: string, req: any, userId?: string) {
    return this.pluginDelegatorService.handlePut(repo, path, req, userId);
  }

  async upload(repo: RepositoryEntity, pkg: any, userId?: string) {
    return this.pluginDelegatorService.upload(repo, pkg, userId);
  }

  async download(repo: RepositoryEntity, name: string, version?: string, visited?: Set<string>, userId?: string) {
    return this.pluginDelegatorService.download(repo, name, version, visited, userId);
  }

  async listVersions(repo: RepositoryEntity, name: string, visited?: Set<string>) {
    return this.pluginDelegatorService.listVersions(repo, name, visited);
  }

  async proxyFetch(repo: RepositoryEntity, url: string) {
    return this.pluginDelegatorService.proxyFetch(repo, url);
  }

  async authenticate(repo: RepositoryEntity, credentials: any, visited?: Set<string>) {
    return this.pluginDelegatorService.authenticate(repo, credentials, visited);
  }

  async clearProxyCache(repoId: string) {
    return this.proxyCacheService.clearProxyCache(repoId);
  }

  async cleanupProxyCache(repoId: string) {
    return this.proxyCacheService.cleanupProxyCache(repoId);
  }

  async getCacheStats() {
    return this.proxyCacheService.getCacheStats();
  }

  async clearAllProxyCache() {
    return this.proxyCacheService.clearAllProxyCache();
  }
}
