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
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RepositoryEntity } from './repository.entity';

@Entity({ name: 'artifacts' })
@Index(['repositoryId'])
@Index(['repositoryId', 'path'])
export class Artifact {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RepositoryEntity)
  @JoinColumn({ name: 'repository_id' })
  repository: RepositoryEntity;

  @Column()
  repositoryId: string;

  @Column({ nullable: true })
  manager?: string;

  @Column({ nullable: true })
  packageName?: string;

  @Column({ nullable: true })
  version?: string;

  @Column({ nullable: true })
  path?: string;

  @Column()
  storageKey: string;

  @Column({ nullable: true })
  contentHash?: string;

  @Column('bigint', { nullable: true })
  size?: number;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastAccessedAt?: Date;
}
