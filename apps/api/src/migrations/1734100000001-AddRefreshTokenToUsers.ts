import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class Migration1734100000001 implements MigrationInterface {

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.addColumn("users", new TableColumn({
            name: "refreshTokenHash",
            type: "varchar",
            isNullable: true
        }));
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.dropColumn("users", "refreshTokenHash");
    }

}
