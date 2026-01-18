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
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  HttpException,
  HttpStatus,
  Req,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import * as bcrypt from 'bcryptjs';
import AppDataSource from '../../data-source';
import { Role } from '../../entities/role.entity';

@Controller('users')
@UseGuards(PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Permissions('user.read')
  async list() {
    const all = await this.users.findAll();
    // sanitize passwordhash
    return all.map((u) => {
      const { passwordhash, ...rest } = u;
      return rest;
    });
  }

  @Get(':id')
  @Permissions('user.read')
  async get(@Param('id') id: string) {
    const u = await this.users.findOne(id);
    if (!u) throw new HttpException('not found', HttpStatus.NOT_FOUND);
    const { passwordhash, ...rest } = u;
    return rest;
  }

  @Post()
  @Permissions('user.manage')
  async create(@Body() body: any) {
    if (!body.username || !body.password)
      throw new HttpException('missing fields', HttpStatus.BAD_REQUEST);

    const exists = await this.users.findByUsername(body.username);
    if (exists) throw new HttpException('username taken', HttpStatus.CONFLICT);

    const passwordhash = await bcrypt.hash(body.password, 10);
    const userData: any = {
      username: body.username,
      displayName: body.displayName,
      passwordhash,
    };

    // handle roles if provided
    if (body.roles && Array.isArray(body.roles)) {
      const roleRepo = AppDataSource.getRepository(Role);
      const roles: Role[] = [];
      for (const rName of body.roles) {
        const r = await roleRepo.findOne({ where: { name: rName } });
        if (r) roles.push(r);
      }
      userData.roles = roles;
    }

    const created = await this.users.create(userData);
    const { passwordhash: _, ...rest } = created;
    return rest;
  }

  @Put(':id')
  @Permissions('user.write')
  async update(@Param('id') id: string, @Body() body: any) {
    const u = await this.users.findOne(id);
    if (!u) throw new HttpException('not found', HttpStatus.NOT_FOUND);

    const updateData: any = {};
    if (body.displayName) updateData.displayName = body.displayName;
    if (body.password) {
      updateData.passwordhash = await bcrypt.hash(body.password, 10);
    }

    // handle roles update
    if (body.roles && Array.isArray(body.roles)) {
      const roleRepo = AppDataSource.getRepository(Role);
      const roles: Role[] = [];
      for (const rName of body.roles) {
        const r = await roleRepo.findOne({ where: { name: rName } });
        if (r) roles.push(r);
      }
      updateData.roles = roles;
    }

    const updated = await this.users.update(id, updateData);
    const { passwordhash: _, ...rest } = updated!;
    return rest;
  }

  @Delete(':id')
  @Permissions('user.manage')
  async delete(@Param('id') id: string, @Req() req: any) {
    // Prevent self-deletion
    if (req.user && req.user.id === id) {
      throw new HttpException(
        'Cannot delete your own account',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.users.delete(id);
    return { ok: true };
  }
}
