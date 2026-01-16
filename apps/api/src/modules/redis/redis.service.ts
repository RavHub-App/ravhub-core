import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    private client: Redis | null = null;
    private enabled = false;

    onModuleInit() {
        this.enabled = process.env.REDIS_ENABLED === 'true';

        if (!this.enabled) {
            this.logger.log('Redis is disabled (REDIS_ENABLED=false). Running in standalone mode.');
            return;
        }

        const host = process.env.REDIS_HOST || 'localhost';
        const port = parseInt(process.env.REDIS_PORT || '6379', 10);
        const password = process.env.REDIS_PASSWORD;
        const db = parseInt(process.env.REDIS_DB || '0', 10);

        this.client = new Redis({
            host,
            port,
            password,
            db,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });

        this.client.on('connect', () => {
            this.logger.log(`Successfully connected to Redis at ${host}:${port}`);
        });

        this.client.on('error', (err) => {
            this.logger.error(`Redis connection error: ${err.message}`);
        });
    }

    onModuleDestroy() {
        if (this.client) {
            this.client.disconnect();
        }
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    getClient(): Redis | null {
        return this.client;
    }

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
        if (!this.client) return;
        if (ttlSeconds) {
            await this.client.set(key, value, 'EX', ttlSeconds);
        } else {
            await this.client.set(key, value);
        }
    }

    async get(key: string): Promise<string | null> {
        if (!this.client) return null;
        return this.client.get(key);
    }

    async del(key: string): Promise<void> {
        if (!this.client) return;
        await this.client.del(key);
    }
}
