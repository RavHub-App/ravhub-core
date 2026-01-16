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
