import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1701163400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                key varchar NOT NULL UNIQUE,
                description text
            );
        `);

    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                role_id uuid NOT NULL,
                permission_id uuid NOT NULL,
                PRIMARY KEY (role_id, permission_id),
                CONSTRAINT fk_role_perm_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                CONSTRAINT fk_role_perm_perm FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
            );
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS role_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS permissions`);
  }
}
