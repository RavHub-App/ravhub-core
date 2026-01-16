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
// BackupModule is loaded dynamically
import { JobsModule } from './modules/jobs/jobs.module';
import { CleanupModule } from './modules/cleanup/cleanup.module';
import { AuditModule } from './modules/audit/audit.module';
import { LicenseModule } from './modules/license/license.module';
import { RedisModule } from './modules/redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
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
        // eslint-disable-next-line @typescript-eslint/no-var-requires
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
