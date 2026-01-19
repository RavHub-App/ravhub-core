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

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import AppDataSource from '../../data-source';
import { ProxyCacheService } from './proxy-cache.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class ProxyCacheJobService implements OnModuleDestroy {
  private readonly logger = new Logger(ProxyCacheJobService.name);
  private jobProcessorInterval: NodeJS.Timeout | null = null;
  private schedulerInterval: NodeJS.Timeout | null = null;

  constructor(
    private readonly proxyCacheService: ProxyCacheService,
    private readonly auditService: AuditService,
  ) { }

  onModuleDestroy() {
    if (this.jobProcessorInterval) {
      clearInterval(this.jobProcessorInterval);
      this.jobProcessorInterval = null;
    }
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  async startJobProcessor() {
    let waited = 0;
    while (!AppDataSource.isInitialized && waited < 60) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waited += 1;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn('Job processor: DB not ready, skipping');
      return;
    }

    const { Job } = require('../../entities/job.entity');
    const jobRepo = AppDataSource.getRepository(Job);

    this.logger.log('Starting proxy cache cleanup job processor');

    this.jobProcessorInterval = setInterval(async () => {
      try {
        const queryRunner = AppDataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let job;
        try {
          const jobs = await queryRunner.query(
            `SELECT * FROM jobs
             WHERE type = $1
             AND status = $2
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            ['proxy-cache-cleanup', 'pending'],
          );

          job = jobs[0];

          if (!job) {
            await queryRunner.rollbackTransaction();
            return;
          }

          await queryRunner.query(
            `UPDATE jobs SET status = $1, started_at = NOW() WHERE id = $2`,
            ['running', job.id],
          );

          await queryRunner.commitTransaction();
        } catch (err) {
          await queryRunner.rollbackTransaction();
          throw err;
        } finally {
          await queryRunner.release();
        }

        this.logger.log(`Processing proxy cache cleanup job ${job.id}`);

        try {
          const result =
            await this.proxyCacheService.executeProxyCacheCleanup();

          await jobRepo.update(job.id, {
            status: 'completed' as any,
            completedAt: new Date(),
            result,
          });

          await this.auditService
            .logSuccess({
              action: 'proxy-cache.cleanup',
              entityType: 'proxy-cache',
              details: {
                totalDeleted: result.total,
                byRepository: result.byRepo,
              },
            })
            .catch(() => { });

          this.logger.log(
            `Completed proxy cache cleanup job ${job.id}: ${result.total} files deleted`,
          );
        } catch (err: any) {
          this.logger.error(
            `Failed to process proxy cache cleanup job ${job.id}: ${err.message}`,
          );

          const attempts = (job.attempts || 0) + 1;
          const maxAttempts = job.max_attempts || 3;

          if (attempts >= maxAttempts) {
            await jobRepo.update(job.id, {
              status: 'failed' as any,
              completedAt: new Date(),
              error: err.message,
              attempts,
            });
          } else {
            await jobRepo.update(job.id, {
              status: 'pending' as any,
              error: err.message,
              attempts,
            });
          }
        }
      } catch (err: any) {
        this.logger.debug(`Job processor error: ${err.message}`);
      }
    }, 30000);
  }

  async startProxyCacheCleanupScheduler() {
    const intervalSec = parseInt(
      process.env.PROXY_CACHE_CLEANUP_INTERVAL_SECONDS || '3600',
      10,
    );

    const maxWaitSec = 60;
    let waited = 0;
    while (!AppDataSource.isInitialized && waited < maxWaitSec) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      waited += 1;
    }

    if (!AppDataSource.isInitialized) {
      this.logger.warn(
        'Proxy cache cleanup scheduler: DB not ready, skipping scheduler',
      );
      return;
    }

    const { Job } = require('../../entities/job.entity');
    const jobRepo = AppDataSource.getRepository(Job);

    const tryBecomeLeaderAndCreateJob = async () => {
      const SCHEDULER_LOCK_KEY = 999999;
      const queryRunner = AppDataSource.createQueryRunner();

      try {
        await queryRunner.connect();

        const lockResult = await queryRunner.query(
          'SELECT pg_try_advisory_lock($1) as locked',
          [SCHEDULER_LOCK_KEY],
        );

        if (!lockResult[0]?.locked) {
          return;
        }

        const existingJob = await jobRepo.findOne({
          where: {
            type: 'proxy-cache-cleanup' as any,
            status: 'pending' as any,
          },
        });

        if (!existingJob) {
          await jobRepo.save(
            jobRepo.create({
              type: 'proxy-cache-cleanup' as any,
              status: 'pending' as any,
              payload: {},
              maxAttempts: 3,
            }),
          );
          this.logger.log('Leader created proxy cache cleanup job');
        }

        await queryRunner.query('SELECT pg_advisory_unlock($1)', [
          SCHEDULER_LOCK_KEY,
        ]);
      } catch (err: any) {
        this.logger.warn(
          `Failed to create proxy cache cleanup job: ${err.message}`,
        );
      } finally {
        await queryRunner.release();
      }
    };

    await tryBecomeLeaderAndCreateJob();

    const interval = Math.max(60, intervalSec) * 1000;
    this.logger.log(
      `Starting proxy cache cleanup job scheduler (interval ${interval / 1000}s)`,
    );

    this.schedulerInterval = setInterval(async () => {
      try {
        if (!AppDataSource.isInitialized) return;
        await tryBecomeLeaderAndCreateJob();
      } catch (err: any) {
        this.logger.debug(
          `Failed to create proxy cache cleanup job: ${err.message}`,
        );
      }
    }, interval);
  }
}
