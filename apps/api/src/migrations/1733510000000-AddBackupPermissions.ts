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

export class Migration1733510000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert backup permissions
    await queryRunner.query(`
            INSERT INTO "permissions" ("key", "description") 
            VALUES 
                ('backup.read', 'Read backups and schedules'),
                ('backup.manage', 'Create, restore, and delete backups')
            ON CONFLICT ("key") DO NOTHING;
        `);

    // Assign to superadmin and admin roles
    await queryRunner.query(`
            INSERT INTO "role_permissions" ("role_id", "permission_id")
            SELECT r.id, p.id
            FROM "roles" r
            CROSS JOIN "permissions" p
            WHERE r."name" IN ('superadmin', 'admin')
            AND p."key" IN ('backup.read', 'backup.manage')
            ON CONFLICT DO NOTHING;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove role_permissions entries
    await queryRunner.query(`
            DELETE FROM "role_permissions"
            WHERE "permission_id" IN (
                SELECT id FROM "permissions" 
                WHERE "key" IN ('backup.read', 'backup.manage')
            );
        `);

    // Remove permissions
    await queryRunner.query(`
            DELETE FROM "permissions" 
            WHERE "key" IN ('backup.read', 'backup.manage');
        `);
  }
}
