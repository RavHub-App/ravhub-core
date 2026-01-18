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

export class Migration1733550000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create jobs table
    await queryRunner.query(`
            CREATE TABLE "jobs" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "type" VARCHAR(50) NOT NULL,
                "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
                "payload" JSONB,
                "result" JSONB,
                "error" TEXT,
                "lock_id" VARCHAR(255),
                "locked_at" TIMESTAMP,
                "started_at" TIMESTAMP,
                "completed_at" TIMESTAMP,
                "attempts" INTEGER NOT NULL DEFAULT 0,
                "max_attempts" INTEGER NOT NULL DEFAULT 3,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);

    // Create indexes
    await queryRunner.query(`CREATE INDEX "IDX_job_type" ON "jobs"("type")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_job_status" ON "jobs"("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_lock_id" ON "jobs"("lock_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_created_at" ON "jobs"("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jobs"`);
  }
}
