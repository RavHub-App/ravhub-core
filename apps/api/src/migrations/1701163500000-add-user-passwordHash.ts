import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1701163500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS passwordhash varchar;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE users DROP COLUMN IF EXISTS passwordhash;`,
    );
  }
}

// No default export: migration is exported by class name only to avoid duplicate-exports detection
