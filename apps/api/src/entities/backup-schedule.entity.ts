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
import { StorageConfig } from './storage-config.entity';

export type ScheduleFrequency = 'hourly' | 'daily' | 'weekly' | 'monthly';

@Entity('backup_schedules')
export class BackupSchedule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'varchar' })
  frequency: ScheduleFrequency;

  // Cron expression for advanced scheduling
  @Column({ name: 'cron_expression', nullable: true })
  cronExpression?: string;

  // Backup configuration
  @Column({ name: 'backup_type', type: 'varchar', default: 'full' })
  backupType: 'full' | 'incremental' | 'differential';

  @Column({ name: 'storage_config_id', nullable: true })
  storageConfigId?: string;

  @ManyToOne(() => StorageConfig, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'storage_config_id' })
  storageConfig?: StorageConfig;

  @Column({ type: 'jsonb', nullable: true })
  options?: {
    databases?: string[];
    repositories?: string[];
    includeArtifacts?: boolean;
    includeConfigs?: boolean;
    compression?: string;
    encryption?: boolean;
    retentionDays?: number;
    [key: string]: any;
  };

  // Timing
  @Column({ name: 'last_run_at', type: 'timestamp', nullable: true })
  lastRunAt?: Date;

  @Column({ name: 'next_run_at', type: 'timestamp', nullable: true })
  nextRunAt?: Date;

  // Creator
  @Column({ name: 'created_by_id', nullable: true })
  createdById?: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
