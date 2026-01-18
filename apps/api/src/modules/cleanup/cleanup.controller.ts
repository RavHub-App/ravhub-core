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
  UseGuards,
  Req,
} from '@nestjs/common';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { RequirePermissions } from '../rbac/permissions.decorator';
import { CleanupService } from './cleanup.service';
import { CleanupPolicy } from '../../entities/cleanup-policy.entity';

@Controller('cleanup')
@UseGuards(PermissionsGuard)
export class CleanupController {
  constructor(private readonly cleanupService: CleanupService) {}

  @Get('policies')
  @RequirePermissions('cleanup.read')
  async listPolicies(): Promise<CleanupPolicy[]> {
    return this.cleanupService.findAll();
  }

  @Get('policies/:id')
  @RequirePermissions('cleanup.read')
  async getPolicy(@Param('id') id: string): Promise<CleanupPolicy> {
    return this.cleanupService.findOne(id);
  }

  @Post('policies')
  @RequirePermissions('cleanup.manage')
  async createPolicy(
    @Body() body: any,
    @Req() req: any,
  ): Promise<CleanupPolicy> {
    return this.cleanupService.create({
      name: body.name,
      description: body.description,
      enabled: body.enabled,
      target: body.target,
      strategy: body.strategy,
      maxAgeDays: body.maxAgeDays,
      maxCount: body.maxCount,
      maxSizeBytes: body.maxSizeBytes,
      repositoryIds: body.repositoryIds,
      keepTagPattern: body.keepTagPattern,
      frequency: body.frequency,
      scheduleTime: body.scheduleTime,
      createdById: req.user?.id,
    });
  }

  @Put('policies/:id')
  @RequirePermissions('cleanup.manage')
  async updatePolicy(
    @Param('id') id: string,
    @Body() body: Partial<CleanupPolicy>,
  ): Promise<CleanupPolicy> {
    return this.cleanupService.update(id, body);
  }

  @Delete('policies/:id')
  @RequirePermissions('cleanup.manage')
  async deletePolicy(@Param('id') id: string): Promise<void> {
    return this.cleanupService.delete(id);
  }

  @Post('policies/:id/execute')
  @RequirePermissions('cleanup.manage')
  async executePolicy(
    @Param('id') id: string,
  ): Promise<{ deleted: number; freedBytes: number }> {
    return this.cleanupService.execute(id);
  }
}
