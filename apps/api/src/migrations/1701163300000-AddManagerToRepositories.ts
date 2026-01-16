import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1701163300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE repositories ADD COLUMN IF NOT EXISTS manager varchar DEFAULT 'npm'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE repositories DROP COLUMN IF EXISTS manager`,
    );
  }
}
