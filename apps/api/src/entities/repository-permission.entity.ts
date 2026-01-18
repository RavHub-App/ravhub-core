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
  ManyToOne,
  CreateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from './user.entity';
import { Role } from './role.entity';
import { RepositoryEntity } from './repository.entity';

@Entity({ name: 'repository_permissions' })
export class RepositoryPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => RepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: RepositoryEntity;

  @Column()
  repositoryId: string;

  @ManyToOne(() => User, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;

  @Column({ nullable: true })
  userId?: string;

  @ManyToOne(() => Role, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'roleId' })
  role?: Role;

  @Column({ nullable: true })
  roleId?: string;

  @Column({ type: 'varchar', length: 20 })
  permission: 'read' | 'write' | 'admin';

  @CreateDateColumn()
  createdAt: Date;
}
