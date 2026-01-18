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

import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
} from 'typeorm';

export class Migration1701163800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'artifacts',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            isGenerated: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'repository_id',
            type: 'uuid',
          },
          {
            name: 'repositoryId',
            type: 'varchar',
          },
          {
            name: 'manager',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'packageName',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'version',
            type: 'varchar',
            isNullable: true,
          },
          {
            name: 'storageKey',
            type: 'varchar',
          },
          {
            name: 'size',
            type: 'bigint',
            isNullable: true,
          },
          {
            name: 'metadata',
            type: 'json',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamp',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createForeignKey(
      'artifacts',
      new TableForeignKey({
        columnNames: ['repository_id'],
        referencedColumnNames: ['id'],
        referencedTableName: 'repositories',
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('artifacts');
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf('repository_id') !== -1,
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey('artifacts', foreignKey);
      }
    }
    await queryRunner.dropTable('artifacts', true);
  }
}
