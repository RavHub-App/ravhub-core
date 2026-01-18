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
