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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { UpstreamPingService } from './upstream-ping.service';
import { PluginDelegatorService } from './plugin-delegator.service';
import { ProxyCacheJobService } from './proxy-cache-job.service';

@Injectable()
export class PluginManagerService implements OnModuleInit {
  private readonly logger = new Logger(PluginManagerService.name);

  constructor(
    private readonly upstreamPingService: UpstreamPingService,
    private readonly pluginDelegatorService: PluginDelegatorService,
    private readonly proxyCacheJobService: ProxyCacheJobService,
  ) {}

  async onModuleInit() {
    await this.onModuleInitSchedulerStarter();
    setTimeout(() => this.startJobProcessor().catch(() => {}), 3000);
  }

  async onModuleInitSchedulerStarter() {
    setTimeout(() => this.startUpstreamPingScheduler().catch(() => {}), 1000);
    setTimeout(
      () => this.startProxyCacheCleanupScheduler().catch(() => {}),
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
    return this.proxyCacheJobService.startProxyCacheCleanupScheduler();
  }
}
