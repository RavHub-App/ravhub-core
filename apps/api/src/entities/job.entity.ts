import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobType =
  | 'backup'
  | 'cleanup'
  | 'maintenance'
  | 'proxy-cache-cleanup';

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50 })
  @Index()
  type: JobType;

  @Column({ type: 'varchar', length: 50, default: 'pending' })
  @Index()
  status: JobStatus;

  @Column({ type: 'jsonb', nullable: true })
  payload: any;

  @Column({ type: 'jsonb', nullable: true })
  result: any;

  @Column({ type: 'text', nullable: true })
  error: string;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'lock_id' })
  @Index()
  lockId: string | null; // Instance ID that locked this job

  @Column({ type: 'timestamp', nullable: true, name: 'locked_at' })
  lockedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true, name: 'started_at' })
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'completed_at' })
  completedAt: Date;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 3, name: 'max_attempts' })
  maxAttempts: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
