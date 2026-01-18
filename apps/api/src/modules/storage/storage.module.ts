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

import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageConfig } from '../../entities/storage-config.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import { Backup } from '../../entities/backup.entity';
import { StorageService } from './storage.service';
import { StorageConfigController } from './storage-config.controller';
import { StorageConfigService } from './storage-config.service';
import { AuditModule } from '../audit/audit.module';
import { LicenseModule } from '../license/license.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StorageConfig, RepositoryEntity, Artifact, Backup]),
    forwardRef(() => AuditModule),
    forwardRef(() => LicenseModule),
    RedisModule,
  ],
  controllers: [StorageConfigController],
  providers: [StorageService, StorageConfigService],
  exports: [StorageService, StorageConfigService],
})
export class StorageModule { }
