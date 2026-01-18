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

  @Column({ type: 'integer', nullable: true, name: 'max_age_days' })
  maxAgeDays: number;

  @Column({ type: 'integer', nullable: true, name: 'max_count' })
  maxCount: number;

  @Column({ type: 'bigint', nullable: true, name: 'max_size_bytes' })
  maxSizeBytes: number;

  @Column({ type: 'jsonb', nullable: true, name: 'repository_ids' })
  repositoryIds: string[];

  @Column({
    type: 'varchar',
    length: 255,
    nullable: true,
    name: 'keep_tag_pattern',
  })
  keepTagPattern: string;

  @Column({ type: 'varchar', length: 50, name: 'frequency' })
  frequency: 'daily' | 'weekly' | 'monthly';

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
