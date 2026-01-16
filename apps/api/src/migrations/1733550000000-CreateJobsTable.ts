import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733550000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create jobs table
    await queryRunner.query(`
            CREATE TABLE "jobs" (
                "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
                "type" VARCHAR(50) NOT NULL,
                "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
                "payload" JSONB,
                "result" JSONB,
                "error" TEXT,
                "lock_id" VARCHAR(255),
                "locked_at" TIMESTAMP,
                "started_at" TIMESTAMP,
                "completed_at" TIMESTAMP,
                "attempts" INTEGER NOT NULL DEFAULT 0,
                "max_attempts" INTEGER NOT NULL DEFAULT 3,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
            );
        `);

    // Create indexes
    await queryRunner.query(`CREATE INDEX "IDX_job_type" ON "jobs"("type")`);
    await queryRunner.query(
      `CREATE INDEX "IDX_job_status" ON "jobs"("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_lock_id" ON "jobs"("lock_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_job_created_at" ON "jobs"("created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "jobs"`);
  }
}
