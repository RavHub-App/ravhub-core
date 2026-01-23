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

    let migrationsDir = path.join(__dirname, 'migrations');
    const srcDir = path.join(__dirname, 'src', 'migrations');

    if (fs.existsSync(srcDir)) {
      const defaultCount = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).length : 0;
      const srcCount = fs.readdirSync(srcDir).length;

      if (srcCount > defaultCount) {
        migrationsDir = srcDir;
      }
    }

    console.log(`Scanning for migrations in: ${migrationsDir}`);
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.ts') || f.endsWith('.js'))
      .filter((f) => !f.endsWith('.map'))
      .filter((f) => !f.endsWith('.d.ts'));

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
      executedMigrations.map((m: any) => m.timestamp.toString()),
    );

    console.log(`\n✓ ${executedMigrations.length} migrations already executed`);
    if (executedMigrations.length > 0) {
      executedMigrations.forEach((m: any) => {
        console.log(`  - [${m.timestamp}] ${m.name}`);
      });
    }

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
        const migrationModule = await import(migration.filePath);
        const MigrationClass = migrationModule[migration.className];

        if (!MigrationClass) {
          throw new Error(
            `Migration class ${migration.className} not found in ${migration.filePath}`,
          );
        }

        const instance = new MigrationClass();

        await queryRunner.startTransaction();

        try {
          await instance.up(queryRunner);

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
