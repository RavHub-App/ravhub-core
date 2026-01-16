import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733950200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update plugins-archive to have usage = 'plugin'
    await queryRunner.query(
      `UPDATE "storage_configs" SET "usage" = 'plugin' WHERE "key" = 'plugins-archive'`,
    );

    // Ensure it is set as default if it's the only plugin storage
    await queryRunner.query(
      `UPDATE "storage_configs" SET "isDefault" = true WHERE "key" = 'plugins-archive' AND NOT EXISTS (SELECT 1 FROM "storage_configs" WHERE "usage" = 'plugin' AND "isDefault" = true AND "key" != 'plugins-archive')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "storage_configs" SET "usage" = 'repository' WHERE "key" = 'plugins-archive'`,
    );
  }
}
