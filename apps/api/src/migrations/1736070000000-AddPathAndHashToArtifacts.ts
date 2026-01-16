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
