import { Controller, Get } from '@nestjs/common';
import AppDataSource from '../../data-source';
import { Client } from 'pg';

@Controller('health')
export class HealthController {
  @Get()
  async health() {
    return this.ready();
  }

  @Get('live')
  live() {
    return { status: 'up' };
  }

  @Get('ready')
  async ready() {
    // Ensure AppDataSource is initialized for the health check.
    // In some runtimes (dev watch mode) the Nest TypeOrmModule will manage
    // a connection but the exported AppDataSource instance may not have been
    // initialized by migrations/seeds. Try to initialize it lazily here so
    // /health will reflect the DB connectivity status for both dev and CI flows.
    if (!AppDataSource.isInitialized) {
      try {
        // initialize if possible (quick failure will be caught)

        await AppDataSource.initialize();
      } catch (err: any) {
        // DataSource init can fail in dev due to runtime ESM/CJS import issues
        // (migrations written in TS importing TypeORM types). To avoid making
        // /health unusable in dev/watch mode, try a lightweight direct pg
        // connection as a fallback to verify DB connectivity.
        try {
          const client = new Client({
            host: process.env.POSTGRES_HOST || 'localhost',
            port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
            user: process.env.POSTGRES_USER || 'postgres',
            password: process.env.POSTGRES_PASSWORD || 'postgres',
            database: process.env.POSTGRES_DB || 'ravhub',
          });

          await client.connect();

          await client.query('SELECT 1');
          await client.end();
          // DB is reachable even if AppDataSource failed to initialize
          return { ok: true, db: true };
        } catch (pgErr: any) {
          return { ok: false, db: false, message: String(err?.message || err) };
        }
      }
    }
    try {
      // simple connectivity check
      // TypeORM exposes query on DataSource for raw SQL queries
      // this will throw if DB is not ready

      await (AppDataSource as any).query('SELECT 1');
      return { ok: true, db: true };
    } catch (err: any) {
      return { ok: false, db: false, message: err?.message };
    }
  }
}
