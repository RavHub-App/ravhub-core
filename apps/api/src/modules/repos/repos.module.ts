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
import { RepositoryEntity } from '../../entities/repository.entity';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { RepositoryPermission } from '../../entities/repository-permission.entity';
import { ReposController } from './repos.controller';
import { PluginsModule } from '../plugins/plugins.module';
import { UsersModule } from '../users/users.module';
import { AuthModule } from '../auth/api.module';
import { ReposService } from './repos.service';
import { RepositoryPermissionService } from './repository-permission.service';
import { RepositoryPermissionGuard } from './repository-permission.guard';
import { UnifiedPermissionGuard } from '../rbac/unified-permission.guard';

import { Artifact } from '../../entities/artifact.entity';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { LicenseModule } from '../license/license.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    PluginsModule,
    UsersModule,
    AuthModule,
    StorageModule,
    AuditModule,
    LicenseModule,
    RedisModule,
    TypeOrmModule.forFeature([
      RepositoryEntity,
      Role,
      Permission,
      Artifact,
      RepositoryPermission,
    ]),
  ],
  controllers: [
    // Docker compat routes must be registered before ReposController because
    // ReposController has a catch-all `:id/*` route that would otherwise shadow `/v2/*`.
    require('./docker.controller').DockerCompatController,
    ReposController,
  ],
  providers: [
    ReposService,
    RepositoryPermissionService,
    RepositoryPermissionGuard,
    UnifiedPermissionGuard,
  ],
  exports: [
    ReposService,
    RepositoryPermissionService,
    RepositoryPermissionGuard,
    UnifiedPermissionGuard,
  ],
})
export class ReposModule {}
