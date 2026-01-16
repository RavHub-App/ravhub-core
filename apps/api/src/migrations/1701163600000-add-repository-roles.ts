import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1701163600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS repository_roles (
                role_id uuid NOT NULL,
                repository_id uuid NOT NULL,
                PRIMARY KEY (role_id, repository_id),
                CONSTRAINT fk_repo_role_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                CONSTRAINT fk_repo_role_repo FOREIGN KEY (repository_id) REFERENCES repositories(id) ON DELETE CASCADE
            );
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS repository_roles`);
  }
}
