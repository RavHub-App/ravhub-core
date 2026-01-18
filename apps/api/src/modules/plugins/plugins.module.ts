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

import { Module, forwardRef } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { PluginManagerService } from './plugin-manager.service';
import { PluginsController } from './plugins.controller';
import { LicenseModule } from '../license/license.module';
import { ProxyCacheService } from './proxy-cache.service';
import { UpstreamPingService } from './upstream-ping.service';
import { ArtifactIndexService } from './artifact-index.service';
import { PluginDelegatorService } from './plugin-delegator.service';
import { ProxyCacheJobService } from './proxy-cache-job.service';

@Module({
  imports: [AuditModule, forwardRef(() => LicenseModule), StorageModule],
  providers: [
    PluginsService,
    ProxyCacheService,
    UpstreamPingService,
    ArtifactIndexService,
    PluginDelegatorService,
    ProxyCacheJobService,
    PluginManagerService,
  ],
  controllers: [PluginsController],
  exports: [
    PluginsService,
    PluginManagerService,
    ProxyCacheService,
    UpstreamPingService,
    ArtifactIndexService,
    PluginDelegatorService,
    ProxyCacheJobService,
  ],
})
export class PluginsModule {}
