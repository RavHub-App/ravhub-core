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
  constructor(private readonly cleanupService: CleanupService) { }

  onModuleInit() {
    // Start the cleanup scheduler when the module initializes
    this.cleanupService.startCleanupScheduler();
  }
}
