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
