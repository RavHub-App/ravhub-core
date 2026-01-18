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

export class Migration1733560100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert cleanup permissions
    await queryRunner.query(`
            INSERT INTO permissions (key, description)
            VALUES 
                ('cleanup.read', 'View cleanup policies and their status'),
                ('cleanup.manage', 'Create, update, delete, and execute cleanup policies')
            ON CONFLICT (key) DO NOTHING;
        `);

    // Grant to superadmin and admin roles
    await queryRunner.query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM roles r
            CROSS JOIN permissions p
            WHERE r.name IN ('superadmin', 'admin')
              AND p.key IN ('cleanup.read', 'cleanup.manage')
            ON CONFLICT DO NOTHING;
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM permissions WHERE key LIKE 'cleanup.%'`,
    );
  }
}
