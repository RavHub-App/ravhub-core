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
