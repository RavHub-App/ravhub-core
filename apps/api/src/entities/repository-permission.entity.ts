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

/**
 * Repository-level permissions
 * Allows granting specific permissions to users or roles for individual repositories
 */
@Entity({ name: 'repository_permissions' })
export class RepositoryPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // The repository this permission applies to
  @ManyToOne(() => RepositoryEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'repositoryId' })
  repository: RepositoryEntity;

  @Column()
  repositoryId: string;

  // Either user or role must be set (not both)
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

  // Permission level: 'read', 'write', 'admin'
  // - read: can pull/download packages
  // - write: can push/upload packages
  // - admin: can manage repository settings
  @Column({ type: 'varchar', length: 20 })
  permission: 'read' | 'write' | 'admin';

  @CreateDateColumn()
  createdAt: Date;
}
