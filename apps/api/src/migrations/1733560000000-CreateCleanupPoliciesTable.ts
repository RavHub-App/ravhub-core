/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733560000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "cleanup_policies" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "name" VARCHAR(255) NOT NULL,
                "description" TEXT,
                "enabled" BOOLEAN NOT NULL DEFAULT true,
                "target" VARCHAR(50) NOT NULL,
                "strategy" VARCHAR(50) NOT NULL,
                "max_age_days" INTEGER,
                "max_count" INTEGER,
                "max_size_bytes" BIGINT,
                "repository_pattern" VARCHAR(255),
                "keep_tag_pattern" VARCHAR(255),
                "cron_schedule" VARCHAR(100),
                "last_run_at" TIMESTAMP,
                "next_run_at" TIMESTAMP,
                "created_by_id" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                CONSTRAINT "FK_cleanup_policy_createdBy" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
            );
        `);

    await queryRunner.query(
      `CREATE INDEX "IDX_cleanup_policy_enabled" ON "cleanup_policies"("enabled")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cleanup_policy_next_run_at" ON "cleanup_policies"("next_run_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "cleanup_policies"`);
  }
}
