import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'licenses' })
export class License {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  key: string;

  @Column({ default: 'enterprise' })
  type: string;

  @Column({ default: 'enterprise' })
  tier: string; // Deprecated: use type

  @Column({ type: 'jsonb', default: {} })
  features: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true, default: {} })
  metadata?: Record<string, any>;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'timestamp', nullable: true })
  expiresAt?: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastValidatedAt?: Date;

  @Column({ nullable: true })
  validationUrl?: string;

  @Column({ type: 'text', nullable: true })
  signedToken?: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
