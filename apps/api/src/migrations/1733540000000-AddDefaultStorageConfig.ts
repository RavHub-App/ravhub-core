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

export class Migration1733540000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert default filesystem storage config if it doesn't exist
    await queryRunner.query(`
            INSERT INTO "storage_configs" ("id", "key", "type", "config", "isDefault", "createdAt", "updatedAt")
            VALUES (
                gen_random_uuid(),
                'default-filesystem',
                'filesystem',
                '{}'::jsonb,
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
