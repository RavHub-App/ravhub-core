import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert new permissions for user management
    await queryRunner.query(`
      INSERT INTO permissions (key, description) VALUES
        ('user.read', 'View user information'),
        ('user.write', 'Update user information'),
        ('user.manage', 'Create/delete users and manage their roles'),
        ('role.read', 'View roles and permissions'),
        ('role.manage', 'Create/modify/delete roles and their permissions')
      ON CONFLICT (key) DO NOTHING;
    `);

    // Grant all user and role permissions to superadmin and admin roles
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id
      FROM roles r
      CROSS JOIN permissions p
      WHERE r.name IN ('superadmin', 'admin')
        AND p.key IN ('user.read', 'user.write', 'user.manage', 'role.read', 'role.manage')
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove role_permissions entries for these permissions
    await queryRunner.query(`
      DELETE FROM role_permissions
      WHERE permission_id IN (
        SELECT id FROM permissions
        WHERE key IN ('user.read', 'user.write', 'user.manage', 'role.read', 'role.manage')
      );
    `);

    // Remove the permissions
    await queryRunner.query(`
      DELETE FROM permissions
      WHERE key IN ('user.read', 'user.write', 'user.manage', 'role.read', 'role.manage');
    `);
  }
}
