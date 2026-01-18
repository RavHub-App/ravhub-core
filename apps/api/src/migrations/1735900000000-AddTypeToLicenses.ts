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

export class Migration1735900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add type column if it doesn't exist
    const hasTypeColumn = await queryRunner.hasColumn('licenses', 'type');
    if (!hasTypeColumn) {
      await queryRunner.query(
        `ALTER TABLE "licenses" ADD COLUMN "type" varchar DEFAULT 'enterprise'`,
      );
    }

    // Migrate data from tier to type if needed
    await queryRunner.query(
      `UPDATE "licenses" SET "type" = "tier" WHERE "type" IS NULL OR "type" = 'enterprise'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "licenses" DROP COLUMN IF EXISTS "type"`,
    );
  }
}
