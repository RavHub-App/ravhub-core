import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733950100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "storage_configs" ADD COLUMN "usage" varchar DEFAULT 'repository';
        `);

    // Update existing configs
    await queryRunner.query(`
            UPDATE "storage_configs" SET "usage" = 'plugin' WHERE "key" = 'plugins-archive';
        `);

    // Assuming we might have a backup config or we will create one
    // For now, default is 'repository'
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "storage_configs" DROP COLUMN "usage";
        `);
  }
}
