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

import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private enabled = false;

  onModuleInit() {
    this.enabled = process.env.REDIS_ENABLED === 'true';

    if (!this.enabled) {
      this.logger.log('Redis is disabled. Running in standalone mode.');
      return;
    }

    const password = process.env.REDIS_PASSWORD;
    const db = parseInt(process.env.REDIS_DB || '0', 10);
    const sentinels = process.env.REDIS_SENTINELS; // e.g., "redis-node-0:26379,redis-node-1:26379"
    const sentinelName = process.env.REDIS_SENTINEL_NAME || 'mymaster';

    let options: RedisOptions = {
      password,
      db,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    };

    if (sentinels) {
      const sentinelNodes = sentinels.split(',').map((s) => {
        const [host, port] = s.split(':');
        return { host, port: parseInt(port, 10) };
      });
      options = { ...options, sentinels: sentinelNodes, name: sentinelName };
      this.logger.log(`Connecting to Redis via Sentinel (${sentinels})`);
    } else {
      const host = process.env.REDIS_HOST || 'localhost';
      const port = parseInt(process.env.REDIS_PORT || '6379', 10);
      options = { ...options, host, port };
      this.logger.log(`Connecting to Redis Standalone at ${host}:${port}`);
    }

    this.client = new Redis(options);

    this.client.on('connect', () =>
      this.logger.log('Successfully connected to Redis'),
    );
    this.client.on('error', (err) =>
      this.logger.error(`Redis connection error: ${err.message}`),
    );
  }

  onModuleDestroy() {
    if (this.client) this.client.disconnect();
  }

  isEnabled(): boolean {
    return this.enabled;
  }
  getClient(): Redis | null {
    return this.client;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client) return;
    if (ttlSeconds) await this.client.set(key, value, 'EX', ttlSeconds);
    else await this.client.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    return this.client.get(key);
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }

  /**
   * Executes a task only if a lock can be acquired.
   * Useful for distributed cron jobs.
   */
  async runWithLock(
    key: string,
    ttlMs: number,
    task: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.client) {
      // If redis is disabled, assume single instance and run task
      await task();
      return true;
    }

    // Simple lock using SET NX PX
    const lockKey = `lock:${key}`;
    const acquired = await this.client.set(
      lockKey,
      'locked',
      'PX',
      ttlMs,
      'NX',
    );

    if (acquired === 'OK') {
      try {
        await task();
      } catch (e) {
        this.logger.error(`Error executing locked task ${key}: ${e.message}`);
      }
      return true;
    }

    return false;
  }
}
