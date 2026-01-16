import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1701163200000 implements MigrationInterface {
    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto;`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS roles (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                name varchar NOT NULL UNIQUE,
                description text
            );
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS users (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                username varchar NOT NULL UNIQUE,
                passwordhash varchar
            );
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS user_roles (
                user_id uuid NOT NULL,
                role_id uuid NOT NULL,
                PRIMARY KEY (user_id, role_id),
                CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                CONSTRAINT fk_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
            );
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS repositories (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                name varchar NOT NULL UNIQUE,
                type varchar NOT NULL DEFAULT 'hosted',
                config json
            );
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS plugins (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                key varchar NOT NULL UNIQUE,
                name varchar,
                metadata json
            );
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS metrics (
                id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                key varchar NOT NULL,
                value bigint NOT NULL,
                "createdAt" timestamptz NOT NULL DEFAULT now()
            );
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS metrics`);
        await queryRunner.query(`DROP TABLE IF EXISTS plugins`);
        await queryRunner.query(`DROP TABLE IF EXISTS user_roles`);
        await queryRunner.query(`DROP TABLE IF EXISTS repositories`);
        await queryRunner.query(`DROP TABLE IF EXISTS users`);
        await queryRunner.query(`DROP TABLE IF EXISTS roles`);
    }
}

// No default export: migration is exported by class name only to avoid duplicate-exports detection
