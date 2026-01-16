import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1736340000000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Drop plugin_installations table as it's no longer used (marketplace legacy)
        await queryRunner.query(`DROP TABLE IF EXISTS "plugin_installations"`);

        // 2. Delete legacy 'plugins-archive' or 'system-assets' storage configs
        await queryRunner.query(`
      DELETE FROM "storage_configs" 
      WHERE "key" IN ('plugins-archive', 'system-assets') OR "usage" IN ('plugin', 'system')
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Table and configs cannot be easily restored if dropped/deleted
    }
}
