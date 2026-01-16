import 'reflect-metadata';
import { AppDataSource } from './data-source';
import * as fs from 'fs';
import * as path from 'path';

interface MigrationFile {
  timestamp: number;
  name: string;
  className: string;
  filePath: string;
}

async function runMigrations() {
  try {
    console.log('🚀 Custom Migration System Starting...');
    console.log('Initializing data source...');
    await AppDataSource.initialize();
    console.log('✓ Data source initialized successfully\n');

    // 1. Scan migrations directory
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .filter((f) => !f.endsWith('.map'))
      .filter((f) => !f.endsWith('.d.ts'));

    // 2. Parse and sort migrations by timestamp
    const migrations: MigrationFile[] = files
      .map((file) => {
        const match = file.match(/^(\d+)-(.+)\.(ts|js)$/);
        if (!match) {
          throw new Error(`Invalid migration filename: ${file}`);
        }

        const timestamp = parseInt(match[1], 10);
        const name = match[2];
        const className = `Migration${timestamp}`;

        return {
          timestamp,
          name,
          className,
          filePath: path.join(migrationsDir, file),
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    console.log(`Found ${migrations.length} migration files:\n`);
    migrations.forEach((m, i) => {
      console.log(`  ${i + 1}. [${m.timestamp}] ${m.name}`);
    });

    // 3. Get executed migrations from database
    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();

    // Create migrations table if not exists
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        timestamp bigint NOT NULL,
        name varchar NOT NULL
      )
    `);

    const executedMigrations = await queryRunner.query(
      `SELECT timestamp, name FROM migrations ORDER BY timestamp`,
    );

    const executedTimestamps = new Set(
      executedMigrations.map((m: any) => m.timestamp),
    );

    console.log(`\n✓ ${executedMigrations.length} migrations already executed`);
    if (executedMigrations.length > 0) {
      executedMigrations.forEach((m: any) => {
        console.log(`  - [${m.timestamp}] ${m.name}`);
      });
    }

    // 4. Execute pending migrations
    const pendingMigrations = migrations.filter(
      (m) => !executedTimestamps.has(m.timestamp.toString()),
    );

    if (pendingMigrations.length === 0) {
      console.log('\n✓ No pending migrations to run');
      await queryRunner.release();
      await AppDataSource.destroy();
      process.exit(0);
      return;
    }

    console.log(
      `\n📦 Running ${pendingMigrations.length} pending migrations:\n`,
    );

    let executed = 0;
    for (const migration of pendingMigrations) {
      console.log(`⏳ Executing [${migration.timestamp}] ${migration.name}...`);

      try {
        // Import migration class
        const migrationModule = await import(migration.filePath);
        const MigrationClass = migrationModule[migration.className];

        if (!MigrationClass) {
          throw new Error(
            `Migration class ${migration.className} not found in ${migration.filePath}`,
          );
        }

        // Create instance and run up() method
        const instance = new MigrationClass();

        // Start transaction
        await queryRunner.startTransaction();

        try {
          await instance.up(queryRunner);

          // Register migration as executed
          await queryRunner.query(
            `INSERT INTO migrations (timestamp, name) VALUES ($1, $2)`,
            [migration.timestamp.toString(), migration.name],
          );

          await queryRunner.commitTransaction();
          executed++;
          console.log(
            `✓ [${migration.timestamp}] ${migration.name} completed\n`,
          );
        } catch (err) {
          await queryRunner.rollbackTransaction();
          throw err;
        }
      } catch (error) {
        console.error(
          `✗ Migration [${migration.timestamp}] ${migration.name} failed:`,
        );
        console.error(error);
        await queryRunner.release();
        await AppDataSource.destroy();
        process.exit(1);
      }
    }

    await queryRunner.release();
    await AppDataSource.destroy();

    console.log(`\n✅ Successfully executed ${executed} migrations`);
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration system error:', error);
    process.exit(1);
  }
}

runMigrations();
