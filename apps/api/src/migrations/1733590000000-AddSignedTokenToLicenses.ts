import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class Migration1733590000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      'licenses',
      new TableColumn({
        name: 'signedToken',
        type: 'text',
        isNullable: true,
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('licenses', 'signedToken');
  }
}
