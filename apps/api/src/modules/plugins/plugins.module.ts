import { Module, forwardRef } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { MonitorModule } from '../monitor/monitor.module';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { PluginManagerService } from './plugin-manager.service';
import { PluginsController } from './plugins.controller';
import { LicenseModule } from '../license/license.module';

import { TypeOrmModule } from '@nestjs/typeorm';
import { Plugin } from '../../entities/plugin.entity';

@Module({
  imports: [
    forwardRef(() => MonitorModule),
    AuditModule,
    forwardRef(() => LicenseModule),
    StorageModule,
    TypeOrmModule.forFeature([Plugin]),
  ],
  providers: [
    PluginsService,
    PluginManagerService,
  ],
  controllers: [PluginsController],
  exports: [
    PluginsService,
    PluginManagerService,
  ],
})
export class PluginsModule { }
