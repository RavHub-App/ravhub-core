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
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CleanupPolicy,
  CleanupTarget,
  CleanupStrategy,
} from '../../entities/cleanup-policy.entity';
import { Artifact } from '../../entities/artifact.entity';
import { JobService } from '../jobs/job.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RedlockService } from '../redis/redlock.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
const { minimatch } = require('minimatch');

const execAsync = promisify(exec);

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    @InjectRepository(CleanupPolicy)
    private readonly policyRepo: Repository<CleanupPolicy>,
    @InjectRepository(Artifact)
    private readonly artifactRepo: Repository<Artifact>,
    private readonly jobService: JobService,
    private readonly storageService: StorageService,
    private readonly auditService: AuditService,
    private readonly redlockService: RedlockService,
  ) {}

  async findAll(): Promise<CleanupPolicy[]> {
    return this.policyRepo.find({
      relations: ['createdBy'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<CleanupPolicy> {
    const policy = await this.policyRepo.findOne({
      where: { id },
      relations: ['createdBy'],
    });

    if (!policy) {
      throw new NotFoundException(`Cleanup policy ${id} not found`);
    }

    return policy;
  }

  async create(data: {
    name: string;
    description?: string;
    enabled?: boolean;
    target: string;
    strategy: string;
    maxAgeDays?: number;
    maxCount?: number;
    maxSizeBytes?: number;
    repositoryIds?: string[];
    keepTagPattern?: string;
    frequency?: string;
    scheduleTime?: string;
    createdById?: string;
  }): Promise<CleanupPolicy> {
    const policy = this.policyRepo.create({
      name: data.name,
      description: data.description,
      enabled: data.enabled ?? true,
      target: data.target as CleanupTarget,
      strategy: data.strategy as CleanupStrategy,
      maxAgeDays: data.maxAgeDays,
      maxCount: data.maxCount,
      maxSizeBytes: data.maxSizeBytes,
      repositoryIds: data.repositoryIds || [],
      keepTagPattern: data.keepTagPattern,
      frequency: (data.frequency || 'daily') as any,
      scheduleTime: data.scheduleTime || '02:00',
      createdById: data.createdById,
      nextRunAt: this.calculateNextRun(
        data.frequency || 'daily',
        data.scheduleTime || '02:00',
      ),
    });

    return this.policyRepo.save(policy);
  }

  async update(
    id: string,
    data: Partial<CleanupPolicy>,
  ): Promise<CleanupPolicy> {
    const policy = await this.findOne(id);

    if (data.frequency || data.scheduleTime) {
      data.nextRunAt = this.calculateNextRun(
        data.frequency || policy.frequency,
        data.scheduleTime || policy.scheduleTime,
      );
    }

    await this.policyRepo.update(id, data);
    return this.findOne(id);
  }

  async delete(id: string): Promise<void> {
    await this.policyRepo.delete(id);
  }

  async execute(id: string): Promise<{ deleted: number; freedBytes: number }> {
    const policy = await this.findOne(id);

    const lockKey = `cleanup:policy:${id}`;
    const lockTtl = 10 * 60 * 1000;

    return this.redlockService.runWithLock(lockKey, lockTtl, async () => {
      this.logger.log(`Executing cleanup policy: ${policy.name} (${id})`);

      if (policy.target === 'artifacts') {
        return this.cleanupArtifacts(policy);
      } else if (policy.target === 'docker-blobs') {
        return this.cleanupDockerBlobs(policy);
      }

      throw new Error(`Unknown cleanup target: ${policy.target}`);
    });
  }

  private async cleanupArtifacts(
    policy: CleanupPolicy,
  ): Promise<{ deleted: number; freedBytes: number }> {
    let artifactsToDelete: Artifact[] = [];

    const query = this.artifactRepo
      .createQueryBuilder('artifact')
      .leftJoinAndSelect('artifact.repository', 'repository');

    if (policy.repositoryIds && policy.repositoryIds.length > 0) {
      query.where('artifact.repositoryId IN (:...repoIds)', {
        repoIds: policy.repositoryIds,
      });
      artifactsToDelete = await query.getMany();
    } else {
      artifactsToDelete = await query.getMany();
    }

    if (policy.keepTagPattern) {
      artifactsToDelete = artifactsToDelete.filter(
        (a) => !minimatch(a.version || '', policy.keepTagPattern),
      );
    }

    if (policy.strategy === 'age-based' && policy.maxAgeDays) {
      const cutoffDate = new Date(
        Date.now() - policy.maxAgeDays * 24 * 60 * 60 * 1000,
      );
      artifactsToDelete = artifactsToDelete.filter(
        (a) => a.createdAt < cutoffDate,
      );
    } else if (policy.strategy === 'count-based' && policy.maxCount) {
      const byRepo = new Map<string, Artifact[]>();
      for (const artifact of artifactsToDelete) {
        const repoName = artifact.repository?.name || 'unknown';
        if (!byRepo.has(repoName)) {
          byRepo.set(repoName, []);
        }
        byRepo.get(repoName)!.push(artifact);
      }

      artifactsToDelete = [];
      for (const [_, artifacts] of byRepo) {
        artifacts.sort((a, b) => {
          const dateA = a.lastAccessedAt || a.createdAt;
          const dateB = b.lastAccessedAt || b.createdAt;
          return dateB.getTime() - dateA.getTime();
        });
        if (artifacts.length > policy.maxCount) {
          artifactsToDelete.push(...artifacts.slice(policy.maxCount));
        }
      }
    } else if (policy.strategy === 'size-based' && policy.maxSizeBytes) {
      artifactsToDelete.sort((a, b) => {
        const dateA = (a.lastAccessedAt || a.createdAt).getTime();
        const dateB = (b.lastAccessedAt || b.createdAt).getTime();
        return dateA - dateB;
      });

      const totalSize = artifactsToDelete.reduce(
        (sum, a) => sum + (Number(a.size) || 0),
        0,
      );
      if (totalSize > policy.maxSizeBytes) {
        let currentSize = totalSize;
        const toDelete: Artifact[] = [];
        for (const artifact of artifactsToDelete) {
          if (currentSize <= policy.maxSizeBytes) break;
          toDelete.push(artifact);
          currentSize -= Number(artifact.size) || 0;
        }
        artifactsToDelete = toDelete;
      } else {
        artifactsToDelete = [];
      }
    }

    let freedBytes = 0;
    for (const artifact of artifactsToDelete) {
      try {
        if (artifact.storageKey) {
          await this.storageService.delete(artifact.storageKey);
        }
        freedBytes += Number(artifact.size) || 0;

        await this.artifactRepo.delete(artifact.id);
        this.logger.log(
          `Deleted artifact: ${artifact.repository?.name}/${artifact.version}`,
        );
      } catch (error) {
        if (
          error instanceof ForbiddenException ||
          error.message?.includes('License')
        ) {
          this.logger.warn(
            `Aborting cleanup for policy '${policy.name}' - Storage is Read-Only due to missing/invalid Enterprise license.`,
          );
          break;
        }
        this.logger.error(`Failed to delete artifact ${artifact.id}:`, error);
      }
    }

    await this.policyRepo.update(policy.id, {
      lastRunAt: new Date(),
      nextRunAt: this.calculateNextRun(policy.frequency, policy.scheduleTime),
    });

    await this.auditService
      .logSuccess({
        action: 'cleanup.execute',
        entityType: 'cleanup-policy',
        entityId: policy.id,
        details: {
          policyName: policy.name,
          strategy: policy.strategy,
          deleted: artifactsToDelete.length,
          freedBytes,
          freedMB: (freedBytes / 1024 / 1024).toFixed(2),
        },
      })
      .catch(() => {});

    return { deleted: artifactsToDelete.length, freedBytes };
  }

  private async cleanupDockerBlobs(
    policy: CleanupPolicy,
  ): Promise<{ deleted: number; freedBytes: number }> {
    try {
      this.logger.warn(
        `Cleanup policy '${policy.name}' (target: docker-blobs) skipped. Native Docker Garbage Collection is not yet implemented for the embedded registry. The legacy 'docker exec' implementation was removed as it is incompatible with HA/Kubernetes environments.`,
      );

      await this.policyRepo.update(policy.id, {
        lastRunAt: new Date(),
        nextRunAt: this.calculateNextRun(policy.frequency, policy.scheduleTime),
      });

      return { deleted: 0, freedBytes: 0 };
    } catch (error) {
      this.logger.error('Docker garbage collection failed:', error);
      throw error;
    }
  }

  async createJobsForPendingPolicies(): Promise<void> {
    const now = new Date();
    const pendingPolicies = await this.policyRepo
      .createQueryBuilder('policy')
      .where('policy.enabled = :enabled', { enabled: true })
      .andWhere('policy.next_run_at <= :now', { now })
      .getMany();

    for (const policy of pendingPolicies) {
      try {
        await this.jobService.createJob('cleanup', {
          policyId: policy.id,
          policyName: policy.name,
        });

        await this.policyRepo.update(policy.id, {
          nextRunAt: this.calculateNextRun(
            policy.frequency,
            policy.scheduleTime,
          ),
        });

        this.logger.log(`✓ Created cleanup job for policy: ${policy.name}`);
      } catch (error) {
        this.logger.error(
          `Failed to create cleanup job for policy ${policy.name}:`,
          error,
        );
      }
    }
  }

  async processCleanupJobs(): Promise<void> {
    const job = await this.jobService.acquireJob('cleanup');

    if (!job) {
      return;
    }

    try {
      this.logger.log(
        `Processing cleanup job ${job.id} (${job.payload.policyName})`,
      );

      const result = await this.execute(job.payload.policyId);

      await this.jobService.completeJob(job.id, result);
      this.logger.log(
        `✓ Completed cleanup job ${job.id}: deleted ${result.deleted} items, freed ${(result.freedBytes / 1024 / 1024).toFixed(2)} MB`,
      );
    } catch (error) {
      this.logger.error(`Failed to process cleanup job ${job.id}:`, error);
      await this.jobService.failJob(job.id, error.message);
    }
  }

  startCleanupScheduler(): void {
    this.logger.log('Starting cleanup scheduler and job processor');

    this.createJobsForPendingPolicies().catch((error) => {
      this.logger.error('Failed to create jobs for pending policies:', error);
    });

    setInterval(
      async () => {
        try {
          await this.redlockService.runWithLock(
            'cleanup:scheduler:create-jobs',
            55 * 60 * 1000,
            async () => {
              await this.createJobsForPendingPolicies();
            },
          );
        } catch (error) {
          const isLockError =
            error.name === 'LockError' || error.message?.includes('Lock');
          if (!isLockError) {
            this.logger.error(
              'Failed to create jobs for pending policies:',
              error,
            );
          }
        }
      },
      60 * 60 * 1000,
    );

    this.processCleanupJobs().catch((error) => {
      this.logger.error('Failed to process cleanup jobs:', error);
    });

    setInterval(
      () => {
        this.processCleanupJobs().catch((error) => {
          this.logger.error('Failed to process cleanup jobs:', error);
        });
      },
      5 * 60 * 1000,
    );
  }

  private calculateNextRun(frequency: string, scheduleTime: string): Date {
    const [hours, minutes] = scheduleTime.split(':').map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);

    if (next <= new Date()) {
      switch (frequency) {
        case 'daily':
          next.setDate(next.getDate() + 1);
          break;
        case 'weekly':
          next.setDate(next.getDate() + 7);
          break;
        case 'monthly':
          next.setMonth(next.getMonth() + 1);
          break;
      }
    }
    return next;
  }
}
