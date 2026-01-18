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
