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

import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';
import { ManyToMany, JoinTable } from 'typeorm';
import { Role } from './role.entity';

export type RepoType = 'hosted' | 'proxy' | 'group';

@Entity({ name: 'repositories' })
export class RepositoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ type: 'varchar', default: 'hosted' })
  type: RepoType;

  @Column({ type: 'varchar', nullable: true })
  manager?: string;

  @Column('json', { nullable: true })
  config?: Record<string, any>;

  @ManyToMany(() => Role, { cascade: false })
  @JoinTable({
    name: 'repository_roles',
    joinColumn: { name: 'repository_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'role_id', referencedColumnName: 'id' },
  })
  roles?: Role[];
}
