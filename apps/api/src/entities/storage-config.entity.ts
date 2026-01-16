import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'storage_configs' })
export class StorageConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ type: 'varchar' })
  type: string; // e.g. 'filesystem', 's3'

  @Column('json', { nullable: true })
  config?: Record<string, any>;

  @Column({ type: 'boolean', default: false })
  isDefault?: boolean;

  @Column({ type: 'varchar', default: 'repository' })
  usage?: string; // 'repository', 'plugin', 'backup'

  @CreateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', default: () => 'NOW()' })
  updatedAt: Date;
}
