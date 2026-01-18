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

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { RbacService } from './rbac.service';
import { UseGuards } from '@nestjs/common';
import { Permissions } from './permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

@Controller('rbac')
@UseGuards(PermissionsGuard)
export class RbacController {
  constructor(private readonly service: RbacService) {}

  @Get('roles')
  @Permissions('role.read')
  listRoles() {
    return this.service.getRoles();
  }

  @Get('roles/:id')
  @Permissions('role.read')
  getRole(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Post('roles')
  @Permissions('role.manage')
  createRole(@Body() body: any) {
    return this.service.createRole(body);
  }

  @Put('roles/:id')
  @Permissions('role.manage')
  updateRole(@Param('id') id: string, @Body() body: any) {
    return this.service.updateRole(id, body);
  }

  @Delete('roles/:id')
  @Permissions('role.manage')
  deleteRole(@Param('id') id: string) {
    return this.service.deleteRole(id);
  }

  @Get('permissions')
  @Permissions('role.read')
  listPermissions() {
    return this.service.getPermissions();
  }
}
