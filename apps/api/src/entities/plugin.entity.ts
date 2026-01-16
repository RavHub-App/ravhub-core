import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'plugins' })
export class Plugin {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ nullable: true })
  name?: string;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;
}
