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
    if (!AppDataSource.isInitialized) {
      try {
        await AppDataSource.initialize();
      } catch (err: any) {
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
          return { ok: true, db: true };
        } catch (pgErr: any) {
          return { ok: false, db: false, message: String(err?.message || err) };
        }
      }
    }
    try {
      await (AppDataSource as any).query('SELECT 1');
      return { ok: true, db: true };
    } catch (err: any) {
      return { ok: false, db: false, message: err?.message };
    }
  }
}
