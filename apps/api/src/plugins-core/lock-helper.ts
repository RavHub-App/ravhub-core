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

import { PluginContext } from './plugin.interface';

// Global map for in-memory locks (Bare Metal mode)
const localLocks = new Map<string, Promise<any>>();

/**
 * Executes a task within a lock, supporting both Redis (Cloud) and In-Memory (Bare Metal).
 * 
 * @param context Plugin context containing optional redis client
 * @param key Unique lock key
 * @param task Async task to execute
 * @param ttlMs Lock TTL / Max wait time (default 30s)
 */
export async function runWithLock<T>(
    context: PluginContext | { redis?: any },
    key: string,
    task: () => Promise<T>,
    ttlMs = 30000
): Promise<T> {
    const redis = context.redis;

    // --- Redis Mode (Cloud) ---
    if (redis && typeof redis.set === 'function') {
        const lockKey = `ravhub:lock:${key}`;
        const lockValue = Math.random().toString(36).substring(2) + Date.now();
        const start = Date.now();

        // Spin-lock pattern for Redis
        while (Date.now() - start < ttlMs) {
            try {
                // NX: Set if Not Exists, PX: Expire in ms
                const res = await redis.set(lockKey, lockValue, 'NX', 'PX', ttlMs);

                if (res === 'OK') {
                    try {
                        return await task();
                    } finally {
                        // Safe release: delete only if value matches (prevents deleting others' locks)
                        const currentVal = await redis.get(lockKey);
                        if (currentVal === lockValue) {
                            await redis.del(lockKey);
                        }
                    }
                }
            } catch (err) {
                console.warn(`[HybridLock] Redis error for ${key}:`, err);
            }

            // Wait before retry
            await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`Failed to acquire distributed lock for ${key} after ${ttlMs}ms`);
    }

    // --- In-Memory Mode (Bare Metal) ---
    const previous = localLocks.get(key) || Promise.resolve();

    // Ensure we wait for previous to settle (success or fail) before running
    const next = previous.catch(() => { }).then(async () => {
        return await task();
    });

    localLocks.set(key, next);

    // Auto-cleanup map to prevent leaks
    next.finally(() => {
        if (localLocks.get(key) === next) {
            localLocks.delete(key);
        }
    });

    return next;
}
