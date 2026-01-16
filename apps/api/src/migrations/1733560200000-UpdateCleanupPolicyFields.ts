import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733560200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            -- Remove old columns
            ALTER TABLE cleanup_policies DROP COLUMN IF EXISTS repository_pattern;
            ALTER TABLE cleanup_policies DROP COLUMN IF EXISTS cron_schedule;
            
            -- Add new columns
            ALTER TABLE cleanup_policies ADD COLUMN IF NOT EXISTS repository_ids JSONB DEFAULT '[]';
            ALTER TABLE cleanup_policies ADD COLUMN IF NOT EXISTS frequency VARCHAR(50) DEFAULT 'daily';
            ALTER TABLE cleanup_policies ADD COLUMN IF NOT EXISTS schedule_time VARCHAR(5) DEFAULT '02:00';
            
            -- Update existing policies to have default values
            UPDATE cleanup_policies 
            SET frequency = 'daily', schedule_time = '02:00'
            WHERE frequency IS NULL OR schedule_time IS NULL;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE cleanup_policies DROP COLUMN IF EXISTS repository_ids;
            ALTER TABLE cleanup_policies DROP COLUMN IF EXISTS frequency;
            ALTER TABLE cleanup_policies DROP COLUMN IF EXISTS schedule_time;
            
            ALTER TABLE cleanup_policies ADD COLUMN IF NOT EXISTS repository_pattern VARCHAR(255);
            ALTER TABLE cleanup_policies ADD COLUMN IF NOT EXISTS cron_schedule VARCHAR(100);
        `);
  }
}
