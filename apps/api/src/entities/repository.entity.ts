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
