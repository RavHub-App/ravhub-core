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

import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class Migration1736070000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'artifacts',
      new TableColumn({
        name: 'path',
        type: 'varchar',
        isNullable: true,
      }),
    );
    await queryRunner.addColumn(
      'artifacts',
      new TableColumn({
        name: 'contentHash',
        type: 'varchar',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('artifacts', 'path');
    await queryRunner.dropColumn('artifacts', 'contentHash');
  }
}
