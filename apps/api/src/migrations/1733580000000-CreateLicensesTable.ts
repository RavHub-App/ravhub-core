import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733580000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "licenses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" varchar NOT NULL UNIQUE,
        "tier" varchar NOT NULL DEFAULT 'free',
        "features" jsonb NOT NULL DEFAULT '{}',
        "metadata" jsonb DEFAULT '{}',
        "isActive" boolean NOT NULL DEFAULT true,
        "expiresAt" timestamp,
        "lastValidatedAt" timestamp,
        "validationUrl" varchar,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_licenses_isActive" ON "licenses"("isActive");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_licenses_tier" ON "licenses"("tier");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_licenses_tier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_licenses_isActive"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "licenses"`);
  }
}
