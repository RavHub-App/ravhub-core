import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';

export type CleanupTarget = 'artifacts' | 'docker-blobs';
export type CleanupStrategy = 'age-based' | 'count-based' | 'size-based';

@Entity('cleanup_policies')
export class CleanupPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar', length: 50 })
  target: CleanupTarget;

  @Column({ type: 'varchar', length: 50 })
  strategy: CleanupStrategy;

  // Age-based: delete artifacts older than X days
  @Column({ type: 'integer', nullable: true, name: 'max_age_days' })
  maxAgeDays: number;

  // Count-based: keep only last X artifacts per repository
  @Column({ type: 'integer', nullable: true, name: 'max_count' })
  maxCount: number;

  // Size-based: delete when total size exceeds X MB
  @Column({ type: 'bigint', nullable: true, name: 'max_size_bytes' })
  maxSizeBytes: number;

  // Filter by repository pattern (glob pattern, e.g., "myrepo/*", "*-dev", etc.)
  // Selected repository IDs to apply cleanup
  @Column({ type: 'jsonb', nullable: true, name: 'repository_ids' })
  repositoryIds: string[];

  // Keep artifacts that match tag pattern (e.g., "v*", "latest", etc.)
  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'keep_tag_pattern',
  })
  keepTagPattern: string;

  // Schedule frequency: daily, weekly, monthly
  @Column({ type: 'varchar', length: 50, name: 'frequency' })
  frequency: 'daily' | 'weekly' | 'monthly';

  // Time to run (HH:mm format)
  @Column({ type: 'varchar', length: 5, name: 'schedule_time' })
  scheduleTime: string;

  @Column({ type: 'timestamp', nullable: true, name: 'last_run_at' })
  lastRunAt: Date;

  @Column({ type: 'timestamp', nullable: true, name: 'next_run_at' })
  nextRunAt: Date;

  @Column({ type: 'uuid', nullable: true, name: 'created_by_id' })
  createdById: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
