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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, JobType } from '../../entities/job.entity';
import { randomUUID } from 'crypto';

@Injectable()
export class JobService implements OnModuleInit {
  private readonly logger = new Logger(JobService.name);
  private readonly instanceId = randomUUID();
  private processingInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Job)
    private readonly jobRepo: Repository<Job>,
  ) {}

  onModuleInit() {
    this.logger.log(
      `Job service initialized with instance ID: ${this.instanceId}`,
    );
    this.startJobProcessor();
  }

  async createJob(type: JobType, payload: any, maxAttempts = 3): Promise<Job> {
    const job = this.jobRepo.create({
      type,
      payload,
      status: 'pending',
      maxAttempts,
    });
    return this.jobRepo.save(job);
  }

  async acquireJob(type?: JobType): Promise<Job | null> {
    const queryRunner = this.jobRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let query = `
        SELECT * FROM jobs
        WHERE status = 'pending'
        AND attempts < max_attempts
        AND (lock_id IS NULL OR locked_at < $1)
      `;

      const params: any[] = [new Date(Date.now() - 5 * 60 * 1000)];

      if (type) {
        query += ` AND type = $2`;
        params.push(type);
      }

      query += `
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `;

      const jobs = await queryRunner.query(query, params);
      const job = jobs[0];

      if (!job) {
        await queryRunner.rollbackTransaction();
        return null;
      }

      await queryRunner.query(
        `UPDATE jobs SET 
          lock_id = $1, 
          locked_at = $2, 
          status = $3, 
          started_at = $4, 
          attempts = attempts + 1
        WHERE id = $5`,
        [this.instanceId, new Date(), 'running', new Date(), job.id],
      );

      await queryRunner.commitTransaction();
      return this.jobRepo.findOne({ where: { id: job.id } });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.debug(`Failed to acquire job: ${error.message}`);
      return null;
    } finally {
      await queryRunner.release();
    }
  }

  async refreshJobLock(jobId: string): Promise<boolean> {
    const result = await this.jobRepo
      .createQueryBuilder()
      .update(Job)
      .set({ lockedAt: new Date() })
      .where('id = :id', { id: jobId })
      .andWhere('lock_id = :instanceId', { instanceId: this.instanceId })
      .andWhere('status = :status', { status: 'running' })
      .execute();

    return (result.affected || 0) > 0;
  }

  async completeJob(jobId: string, result?: any): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: 'completed',
      result,
      completedAt: new Date(),
      lockId: null,
    });
  }

  async failJob(jobId: string, error: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) return;

    if (job.attempts >= job.maxAttempts) {
      await this.jobRepo.update(jobId, {
        status: 'failed',
        error,
        completedAt: new Date(),
        lockId: null,
      });
    } else {
      await this.jobRepo.update(jobId, {
        status: 'pending',
        error,
        lockId: null,
        lockedAt: null,
      });
    }
  }

  async cleanupOldJobs(olderThanDays = 7): Promise<number> {
    const cutoffDate = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    );

    const result = await this.jobRepo
      .createQueryBuilder()
      .delete()
      .where('status IN (:...statuses)', { statuses: ['completed', 'failed'] })
      .andWhere('completed_at < :cutoffDate', { cutoffDate })
      .execute();

    return result.affected || 0;
  }

  async releaseStaleLocks(): Promise<number> {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000);

    const result = await this.jobRepo
      .createQueryBuilder()
      .update(Job)
      .set({
        status: 'pending',
        lockId: null,
        lockedAt: null,
      })
      .where('status = :status', { status: 'running' })
      .andWhere('locked_at < :staleTime', { staleTime })
      .execute();

    return result.affected || 0;
  }

  private startJobProcessor(): void {
    this.logger.log('Starting job processor (interval: 30s)');

    this.processJobs().catch((error) => {
      this.logger.error('Failed to process jobs:', error);
    });

    this.processingInterval = setInterval(() => {
      this.processJobs().catch((error) => {
        this.logger.error('Failed to process jobs:', error);
      });
    }, 30 * 1000);

    setInterval(
      () => {
        this.cleanupOldJobs()
          .then((count) => {
            if (count > 0) this.logger.log(`Cleaned up ${count} old jobs`);
          })
          .catch((error) => {
            this.logger.error('Failed to cleanup old jobs:', error);
          });
      },
      60 * 60 * 1000,
    );

    setInterval(
      () => {
        this.releaseStaleLocks()
          .then((count) => {
            if (count > 0)
              this.logger.warn(`Released ${count} stale job locks`);
          })
          .catch((error) => {
            this.logger.error('Failed to release stale locks:', error);
          });
      },
      5 * 60 * 1000,
    );
  }

  private async processJobs(): Promise<void> {}
}
