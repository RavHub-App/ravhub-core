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

import { Module, Global, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { User } from '../../entities/user.entity';
import { Permission } from '../../entities/permission.entity';
import { RepositoryPermission } from '../../entities/repository-permission.entity';
import { PermissionsGuard } from './permissions.guard';
import { PermissionService } from './permission.service';
import { Reflector } from '@nestjs/core';
import { RbacController } from './rbac.controller';
import { RbacService } from './rbac.service';
import { AuditModule } from '../audit/audit.module';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([Role, User, Permission, RepositoryPermission]),
    forwardRef(() => AuditModule),
  ],
  controllers: [RbacController],
  providers: [RbacService, PermissionsGuard, PermissionService, Reflector],
  exports: [RbacService, PermissionsGuard, PermissionService, TypeOrmModule],
})
export class RbacModule {}
