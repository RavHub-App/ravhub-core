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
