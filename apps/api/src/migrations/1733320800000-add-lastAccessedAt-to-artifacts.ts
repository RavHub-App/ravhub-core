import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class Migration1733320800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'artifacts',
      new TableColumn({
        name: 'lastAccessedAt',
        type: 'timestamp',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('artifacts', 'lastAccessedAt');
  }
}
