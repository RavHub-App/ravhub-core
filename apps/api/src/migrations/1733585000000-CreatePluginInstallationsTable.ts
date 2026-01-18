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

import { MigrationInterface, QueryRunner, Table, TableIndex } from 'typeorm';

export class Migration1733585000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'plugin_installations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            generationStrategy: 'uuid',
            default: 'uuid_generate_v4()',
          },
          {
            name: 'name',
            type: 'varchar',
            isUnique: true,
          },
          {
            name: 'version',
            type: 'varchar',
          },
          {
            name: 'downloadUrl',
            type: 'varchar',
          },
          {
            name: 'installedPath',
            type: 'varchar',
          },
          {
            name: 'status',
            type: 'enum',
            enum: [
              'downloading',
              'installing',
              'installed',
              'failed',
              'uninstalled',
            ],
            default: "'downloading'",
          },
          {
            name: 'metadata',
            type: 'jsonb',
            isNullable: true,
          },
          {
            name: 'error',
            type: 'text',
            isNullable: true,
          },
          {
            name: 'createdAt',
            type: 'timestamptz',
            default: 'now()',
          },
          {
            name: 'updatedAt',
            type: 'timestamptz',
            default: 'now()',
          },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'plugin_installations',
      new TableIndex({
        name: 'IDX_plugin_installations_status',
        columnNames: ['status'],
      }),
    );

    await queryRunner.createIndex(
      'plugin_installations',
      new TableIndex({
        name: 'IDX_plugin_installations_name',
        columnNames: ['name'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('plugin_installations');
  }
}
