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

export type BackupStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type BackupType = 'full' | 'incremental' | 'differential';

@Entity('backups')
export class Backup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description?: string;

  @Column({ type: 'varchar', default: 'pending' })
  status: BackupStatus;

  @Column({ type: 'varchar', default: 'full' })
  type: BackupType;

  // Storage destination
  @Column({ name: 'storage_config_id', nullable: true })
  storageConfigId?: string;

  @ManyToOne(() => StorageConfig, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'storage_config_id' })
  storageConfig?: StorageConfig;

  @Column({ name: 'storage_path', nullable: true })
  storagePath?: string;

  // Backup metadata
  @Column({ name: 'size_bytes', type: 'bigint', nullable: true })
  sizeBytes?: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: {
    databases?: string[];
    repositories?: string[];
    includeArtifacts?: boolean;
    includeConfigs?: boolean;
    compression?: string;
    encryption?: boolean;
    [key: string]: any;
  };

  // Progress tracking
  @Column({ name: 'progress_percent', type: 'int', default: 0 })
  progressPercent: number;

  @Column({ name: 'current_step', nullable: true })
  currentStep?: string;

  @Column({ name: 'error_message', nullable: true })
  errorMessage?: string;

  // Timing
  @Column({ name: 'started_at', type: 'timestamp', nullable: true })
  startedAt?: Date;

  @Column({ name: 'completed_at', type: 'timestamp', nullable: true })
  completedAt?: Date;

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
