import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import Redlock, { Lock } from 'redlock';
import { RedisService } from './redis.service';

@Injectable()
export class RedlockService implements OnModuleInit {
    private readonly logger = new Logger(RedlockService.name);
    private redlock: Redlock | null = null;

    constructor(private readonly redisService: RedisService) { }

    onModuleInit() {
        if (!this.redisService.isEnabled()) {
            return;
        }

        const client = this.redisService.getClient();
        if (!client) return;

        this.redlock = new Redlock(
            [client],
            {
                driftFactor: 0.01,
                retryCount: 10,
                retryDelay: 200,
                retryJitter: 200,
                automaticExtensionThreshold: 500,
            }
        );

        this.redlock.on('error', (error) => {
            this.logger.error(`Redlock error: ${error.message}`);
        });
    }

    /**
     * Acquires a lock for a given resource.
     * @param resource The resource name to lock (e.g., 'upload:npm:package-name')
     * @param ttl Time to live in milliseconds
     */
    async lock(resource: string, ttl: number): Promise<Lock | null> {
        if (!this.redlock) return null;
        return this.redlock.acquire([resource], ttl);
    }

    /**
     * Executes a function within a lock.
     * @param resource The resource name to lock
     * @param ttl Time to live in milliseconds
     * @param fn The function to execute
     */
    private memoryLocks: Map<string, Promise<void>> = new Map();

    async runWithLock<T>(resource: string, ttl: number, fn: () => Promise<T>): Promise<T> {
        if (!this.redlock) {
            // In-Memory Mutex Fallback for Single-Replica scenarios without Redis.
            // Node.js is single-threaded but concurrent via async I/O. We must serialize access 
            // to critical sections to prevent race conditions during await operations.

            // 1. Wait if locked
            while (this.memoryLocks.has(resource)) {
                try { await this.memoryLocks.get(resource); } catch { }
            }

            // 2. Acquire Lock
            let release: (() => void) | undefined;
            const lockPromise = new Promise<void>((resolve) => { release = resolve; });
            this.memoryLocks.set(resource, lockPromise);

            try {
                return await fn();
            } finally {
                // 3. Release Lock
                this.memoryLocks.delete(resource);
                if (release) release();
            }
        }

        let lock: Lock | null = null;
        try {
            lock = await this.lock(resource, ttl);
            return await fn();
        } finally {
            if (lock) {
                try {
                    await lock.release();
                } catch (err) {
                    this.logger.error(`Failed to release lock for ${resource}: ${err.message}`);
                }
            }
        }
    }
}
