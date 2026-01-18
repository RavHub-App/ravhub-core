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

import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CleanupController } from './cleanup.controller';
import { CleanupService } from './cleanup.service';
import { CleanupPolicy } from '../../entities/cleanup-policy.entity';
import { Artifact } from '../../entities/artifact.entity';
import { Job } from '../../entities/job.entity';
import { RbacModule } from '../rbac/rbac.module';
import { JobsModule } from '../jobs/jobs.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CleanupPolicy, Artifact, Job]),
    RbacModule,
    StorageModule,
    AuditModule,
    JobsModule,
  ],
  controllers: [CleanupController],
  providers: [CleanupService],
  exports: [CleanupService],
})
export class CleanupModule implements OnModuleInit {
  constructor(private readonly cleanupService: CleanupService) {}

  onModuleInit() {
    // Start the cleanup scheduler when the module initializes
    this.cleanupService.startCleanupScheduler();
  }
}
