import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733540000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert default filesystem storage config if it doesn't exist
    await queryRunner.query(`
            INSERT INTO "storage_configs" ("id", "key", "type", "config", "isDefault", "createdAt", "updatedAt")
            VALUES (
                gen_random_uuid(),
                'default-filesystem',
                'filesystem',
                '{"basePath": "/data/storage/repositories"}'::jsonb,
                true,
                NOW(),
                NOW()
            )
            ON CONFLICT DO NOTHING;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DELETE FROM "storage_configs" WHERE "key" = 'default-filesystem';
        `);
  }
}
