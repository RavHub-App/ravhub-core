import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733520000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create backups table
    await queryRunner.query(`
            CREATE TABLE "backups" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" VARCHAR NOT NULL,
                "description" TEXT,
                "status" VARCHAR NOT NULL DEFAULT 'pending',
                "type" VARCHAR NOT NULL DEFAULT 'full',
                "storage_config_id" uuid,
                "storage_path" VARCHAR,
                "size_bytes" BIGINT,
                "metadata" JSONB DEFAULT '{}',
                "progress_percent" INTEGER DEFAULT 0,
                "current_step" VARCHAR,
                "error_message" TEXT,
                "started_at" TIMESTAMP WITH TIME ZONE,
                "completed_at" TIMESTAMP WITH TIME ZONE,
                "created_by_id" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                CONSTRAINT "FK_backup_storageConfig" FOREIGN KEY ("storage_config_id") REFERENCES "storage_configs"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_backup_createdBy" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
            );
        `);

    // Create backup_schedules table
    await queryRunner.query(`
            CREATE TABLE "backup_schedules" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" VARCHAR NOT NULL,
                "description" TEXT,
                "enabled" BOOLEAN NOT NULL DEFAULT true,
                "frequency" VARCHAR NOT NULL,
                "cron_expression" VARCHAR,
                "backup_type" VARCHAR NOT NULL DEFAULT 'full',
                "storage_config_id" uuid,
                "options" JSONB DEFAULT '{}',
                "last_run_at" TIMESTAMP WITH TIME ZONE,
                "next_run_at" TIMESTAMP WITH TIME ZONE,
                "created_by_id" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                CONSTRAINT "FK_backup_schedule_storageConfig" FOREIGN KEY ("storage_config_id") REFERENCES "storage_configs"("id") ON DELETE SET NULL,
                CONSTRAINT "FK_backup_schedule_createdBy" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
            );
        `);

    // Create indexes
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_status" ON "backups" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_created_at" ON "backups" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_schedule_enabled" ON "backup_schedules" ("enabled")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_backup_schedule_next_run_at" ON "backup_schedules" ("next_run_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_backup_schedule_next_run_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_backup_schedule_enabled"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backup_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_backup_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backup_schedules"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "backups"`);
  }
}
