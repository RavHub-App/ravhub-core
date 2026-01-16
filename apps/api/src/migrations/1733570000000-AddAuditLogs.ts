import { MigrationInterface, QueryRunner } from 'typeorm';

export class Migration1733570000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop alert_rules table if exists
    await queryRunner.query(`DROP TABLE IF EXISTS "alert_rules" CASCADE`);

    // Create audit_logs table
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "userId" uuid,
        "action" varchar NOT NULL,
        "entityType" varchar,
        "entityId" varchar,
        "details" jsonb,
        "ipAddress" varchar,
        "userAgent" varchar,
        "status" varchar NOT NULL DEFAULT 'success',
        "error" text,
        "timestamp" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_audit_logs_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);

    // Create indexes for common queries
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_userId" ON "audit_logs" ("userId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_action" ON "audit_logs" ("action")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_timestamp" ON "audit_logs" ("timestamp" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_status" ON "audit_logs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_logs_entityType" ON "audit_logs" ("entityType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs" CASCADE`);

    // Recreate alert_rules table for rollback
    await queryRunner.query(`
      CREATE TABLE "alert_rules" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "key" varchar UNIQUE NOT NULL,
        "metricKey" varchar NOT NULL,
        "threshold" float NOT NULL,
        "comparator" varchar NOT NULL DEFAULT 'gt',
        "severity" varchar,
        "message" varchar,
        "enabled" boolean NOT NULL DEFAULT true,
        "evaluationWindowSeconds" int NOT NULL DEFAULT 60,
        "lastTriggeredAt" timestamp,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
  }
}
