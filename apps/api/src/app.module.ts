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

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import * as Entities from './entities';
import { AppController } from './app.controller';
import { HealthController } from './modules/health/health.controller';
import { AppService } from './app.service';
import { UsersModule } from './modules/users/users.module';
import { ReposModule } from './modules/repos/repos.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { MonitorModule } from './modules/monitor/monitor.module';
import { AuthModule } from './modules/auth/api.module';
import { JwtAuthGuard } from './modules/auth/auth.guard';
import { APP_GUARD } from '@nestjs/core';
import { PluginsModule } from './modules/plugins/plugins.module';
import { StorageModule } from './modules/storage/storage.module';

import { JobsModule } from './modules/jobs/jobs.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { AuditModule } from './modules/audit/audit.module';
import { LicenseModule } from './modules/license/license.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: (process.env.DB_TYPE as any) || 'postgres',
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      username: process.env.POSTGRES_USER || 'postgres',
      password: process.env.POSTGRES_PASSWORD || 'postgres',
      database: process.env.POSTGRES_DB || 'ravhub',
      entities: Object.values(Entities),
      synchronize: process.env.TYPEORM_SYNC === 'true',
      logging: false,
    }),
    RedisModule,
    UsersModule,
    AuthModule,
    ReposModule,
    RbacModule,
    MonitorModule,
    PluginsModule,
    StorageModule,
    ...(() => {
      try {
        const { BackupModule } = require('./modules/backup/backup.module');
        return [BackupModule];
      } catch (e) {
        return [];
      }
    })(),
    JobsModule,
    CleanupModule,
    AuditModule,
    LicenseModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule { }
