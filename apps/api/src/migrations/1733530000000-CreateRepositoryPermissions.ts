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

export class Migration1733530000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "repository_permissions" (
                "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
                "repositoryId" uuid NOT NULL,
                "userId" uuid,
                "roleId" uuid,
                "permission" varchar(20) NOT NULL,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "fk_repository_permission_repository" FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_repository_permission_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
                CONSTRAINT "fk_repository_permission_role" FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE CASCADE,
                CONSTRAINT "chk_user_or_role" CHECK (
                    ("userId" IS NOT NULL AND "roleId" IS NULL) OR 
                    ("userId" IS NULL AND "roleId" IS NOT NULL)
                )
            )
        `);

    // Create indexes for performance
    await queryRunner.query(`
            CREATE INDEX "idx_repository_permissions_repository" ON "repository_permissions" ("repositoryId")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_repository_permissions_user" ON "repository_permissions" ("userId")
        `);
    await queryRunner.query(`
            CREATE INDEX "idx_repository_permissions_role" ON "repository_permissions" ("roleId")
        `);

    // Create unique constraint to prevent duplicate permissions
    await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_repository_permissions_unique_user" 
            ON "repository_permissions" ("repositoryId", "userId", "permission") 
            WHERE "userId" IS NOT NULL
        `);
    await queryRunner.query(`
            CREATE UNIQUE INDEX "idx_repository_permissions_unique_role" 
            ON "repository_permissions" ("repositoryId", "roleId", "permission") 
            WHERE "roleId" IS NOT NULL
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "repository_permissions"`);
  }
}
