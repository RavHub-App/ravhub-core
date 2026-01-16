import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1735900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add type column if it doesn't exist
    const hasTypeColumn = await queryRunner.hasColumn('licenses', 'type');
    if (!hasTypeColumn) {
      await queryRunner.query(`ALTER TABLE "licenses" ADD COLUMN "type" varchar DEFAULT 'enterprise'`);
    }

    // Migrate data from tier to type if needed
    await queryRunner.query(`UPDATE "licenses" SET "type" = "tier" WHERE "type" IS NULL OR "type" = 'enterprise'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "licenses" DROP COLUMN IF EXISTS "type"`);
  }
}
