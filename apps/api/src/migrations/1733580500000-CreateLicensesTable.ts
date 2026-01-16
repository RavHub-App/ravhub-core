import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733580500000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS licenses (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar NOT NULL UNIQUE,
        "isActive" boolean DEFAULT true,
        "activatedAt" timestamptz,
        "expiresAt" timestamptz,
        metadata jsonb,
        "createdAt" timestamptz DEFAULT now(),
        "updatedAt" timestamptz DEFAULT now()
      );
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_licenses_active ON licenses("isActive") WHERE "isActive" = true;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS licenses CASCADE;`);
  }
}
