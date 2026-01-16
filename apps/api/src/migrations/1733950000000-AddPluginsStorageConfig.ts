import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733950000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert plugins-archive storage config if it doesn't exist
    // We use a specific path for plugins archive to keep them separate
    await queryRunner.query(`
            INSERT INTO "storage_configs" ("id", "key", "type", "config", "isDefault", "createdAt", "updatedAt")
            VALUES (
                gen_random_uuid(),
                'plugins-archive',
                'filesystem',
                '{"basePath": "/data/storage/plugins-archive"}'::jsonb,
                false,
                NOW(),
                NOW()
            )
            ON CONFLICT ("key") DO NOTHING;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DELETE FROM "storage_configs" WHERE "key" = 'plugins-archive';
        `);
  }
}
