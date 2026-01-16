import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
} from '@nestjs/common';
import { StorageConfigService } from './storage-config.service';
import { UseGuards } from '@nestjs/common';
import { Permissions } from '../rbac/permissions.decorator';
import { PermissionsGuard } from '../rbac/permissions.guard';
import { LicenseGuard } from '../license/license.guard';
import { RequireLicense } from '../license/license.decorator';

@Controller('storage/configs')
@UseGuards(PermissionsGuard)
export class StorageConfigController {
  constructor(private readonly service: StorageConfigService) { }

  @Get()
  @Permissions('system.admin', 'backup.read')
  async list() {
    return this.service.listWithStats();
  }

  @Post()
  @Permissions('system.admin')
  async create(@Body() body: any) {
    return this.service.create(body);
  }

  @Get(':id')
  @Permissions('system.admin', 'backup.read')
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Put(':id')
  @Permissions('system.admin')
  async update(@Param('id') id: string, @Body() body: any) {
    return this.service.update(id, body);
  }

  @Delete(':id')
  @Permissions('system.admin')
  async remove(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
