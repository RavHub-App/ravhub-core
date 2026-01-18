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

export class Migration1733580000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "licenses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" varchar NOT NULL UNIQUE,
        "tier" varchar NOT NULL DEFAULT 'free',
        "features" jsonb NOT NULL DEFAULT '{}',
        "metadata" jsonb DEFAULT '{}',
        "isActive" boolean NOT NULL DEFAULT true,
        "expiresAt" timestamp,
        "lastValidatedAt" timestamp,
        "validationUrl" varchar,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_licenses_isActive" ON "licenses"("isActive");
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_licenses_tier" ON "licenses"("tier");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_licenses_tier"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_licenses_isActive"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "licenses"`);
  }
}
