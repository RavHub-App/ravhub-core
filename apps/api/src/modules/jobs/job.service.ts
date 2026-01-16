import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan, IsNull } from 'typeorm';
import { Job, JobStatus, JobType } from '../../entities/job.entity';
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

  /**
   * Create a new job
   */
  async createJob(type: JobType, payload: any, maxAttempts = 3): Promise<Job> {
    const job = this.jobRepo.create({
      type,
      payload,
      status: 'pending',
      maxAttempts,
    });

    return this.jobRepo.save(job);
  }

  /**
   * Acquire a lock on a pending job (distributed locking)
   * Uses SELECT FOR UPDATE SKIP LOCKED for atomic pessimistic locking
   */
  async acquireJob(type?: JobType): Promise<Job | null> {
    // Use a transaction to ensure atomicity
    const queryRunner = this.jobRepo.manager.connection.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // Use raw SQL for SELECT FOR UPDATE SKIP LOCKED
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

      // Update job atomically in the same transaction
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

      // Return updated job
      return this.jobRepo.findOne({ where: { id: job.id } });
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.debug(`Failed to acquire job: ${error.message}`);
      return null;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * Refresh job lock (heartbeat) to prevent expiration during long-running jobs
   */
  async refreshJobLock(jobId: string): Promise<boolean> {
    const result = await this.jobRepo
      .createQueryBuilder()
      .update(Job)
      .set({
        lockedAt: new Date(),
      })
      .where('id = :id', { id: jobId })
      .andWhere('lock_id = :instanceId', { instanceId: this.instanceId })
      .andWhere('status = :status', { status: 'running' })
      .execute();

    return (result.affected || 0) > 0;
  }

  /**
   * Mark job as completed
   */
  async completeJob(jobId: string, result?: any): Promise<void> {
    await this.jobRepo.update(jobId, {
      status: 'completed',
      result,
      completedAt: new Date(),
      lockId: null,
    });
  }

  /**
   * Mark job as failed
   */
  async failJob(jobId: string, error: string): Promise<void> {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });

    if (!job) {
      return;
    }

    // If max attempts reached, mark as failed permanently
    if (job.attempts >= job.maxAttempts) {
      await this.jobRepo.update(jobId, {
        status: 'failed',
        error,
        completedAt: new Date(),
        lockId: null,
      });
    } else {
      // Release lock so it can be retried
      await this.jobRepo.update(jobId, {
        status: 'pending',
        error,
        lockId: null,
        lockedAt: null,
      });
    }
  }

  /**
   * Clean up old completed/failed jobs
   */
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

  /**
   * Release stale locks (jobs locked for more than 10 minutes)
   */
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

  /**
   * Start the job processor
   */
  private startJobProcessor(): void {
    this.logger.log('Starting job processor (interval: 30s)');

    // Process immediately on startup
    this.processJobs().catch((error) => {
      this.logger.error('Failed to process jobs:', error);
    });

    // Then every 30 seconds
    this.processingInterval = setInterval(() => {
      this.processJobs().catch((error) => {
        this.logger.error('Failed to process jobs:', error);
      });
    }, 30 * 1000);

    // Cleanup old jobs every hour
    setInterval(
      () => {
        this.cleanupOldJobs()
          .then((count) => {
            if (count > 0) {
              this.logger.log(`Cleaned up ${count} old jobs`);
            }
          })
          .catch((error) => {
            this.logger.error('Failed to cleanup old jobs:', error);
          });
      },
      60 * 60 * 1000,
    );

    // Release stale locks every 5 minutes
    setInterval(
      () => {
        this.releaseStaleLocks()
          .then((count) => {
            if (count > 0) {
              this.logger.warn(`Released ${count} stale job locks`);
            }
          })
          .catch((error) => {
            this.logger.error('Failed to release stale locks:', error);
          });
      },
      5 * 60 * 1000,
    );
  }

  /**
   * Process pending jobs (to be implemented by job handlers)
   */
  private async processJobs(): Promise<void> {
    // This will be called by the BackupService to process backup jobs
    // We don't process jobs here, just maintain the infrastructure
  }
}
