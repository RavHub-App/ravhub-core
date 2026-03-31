/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import { uploadTargets } from '../utils/helpers';

type UploadRedis = {
    isEnabled?: () => boolean;
    get?: (key: string) => Promise<string | null>;
    set?: (...args: unknown[]) => Promise<unknown>;
    del?: (key: string) => Promise<unknown>;
};

type ActiveUploadRedis = {
    isEnabled: () => boolean;
    get: (key: string) => Promise<string | null>;
    set: (...args: unknown[]) => Promise<unknown>;
    del: (key: string) => Promise<unknown>;
};

type UploadTarget = {
    groupId: string;
    targets: { repoId: string; uuid: string }[];
    policy: string;
};

const TEMP_DIR = path.join(os.tmpdir(), 'ravhub-uploads');

ensureTempDir();

function ensureTempDir() {
    try {
        if (!fs.existsSync(TEMP_DIR)) {
            fs.mkdirSync(TEMP_DIR, { recursive: true });
        }
    } catch (error) {
        const code = error instanceof Error && 'code' in error ? error.code : '';
        if (code !== 'EEXIST') {
            throw error;
        }
    }
}

function getRedis(redis: UploadRedis | null): ActiveUploadRedis | null {
    if (
        !redis?.isEnabled ||
        !redis.get ||
        !redis.set ||
        !redis.del ||
        !redis.isEnabled()
    ) {
        return null;
    }

    return redis as ActiveUploadRedis;
}

export function createUploadUuid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function getTempFilePath(uuid: string) {
    return path.join(TEMP_DIR, uuid);
}

export async function readStreamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function getUploadMeta(redis: UploadRedis | null, uuid: string) {
    const redisClient = getRedis(redis);
    if (redisClient) {
        const data = await redisClient.get(`docker:plugin:upload-meta:${uuid}`);
        return data ? JSON.parse(data) : null;
    }

    if (fs.existsSync(getTempFilePath(uuid))) {
        return { uuid };
    }

    return null;
}

export async function setUploadMeta(
    redis: UploadRedis | null,
    uuid: string,
    meta: unknown,
) {
    const redisClient = getRedis(redis);
    if (!redisClient) {
        return;
    }

    await redisClient.set(
        `docker:plugin:upload-meta:${uuid}`,
        JSON.stringify(meta),
        'EX',
        86400,
    );
}

export async function deleteUploadMeta(
    redis: UploadRedis | null,
    uuid: string,
) {
    const redisClient = getRedis(redis);
    if (!redisClient) {
        return;
    }

    await redisClient.del(`docker:plugin:upload-meta:${uuid}`);
}

export async function getUploadTarget(redis: UploadRedis | null, uuid: string) {
    const redisClient = getRedis(redis);
    if (redisClient) {
        const data = await redisClient.get(`docker:plugin:targets:${uuid}`);
        return data ? (JSON.parse(data) as UploadTarget) : null;
    }

    return uploadTargets.get(uuid) || null;
}

export async function setUploadTarget(
    redis: UploadRedis | null,
    uuid: string,
    target: UploadTarget,
) {
    const redisClient = getRedis(redis);
    if (redisClient) {
        await redisClient.set(
            `docker:plugin:targets:${uuid}`,
            JSON.stringify(target),
            86400,
        );
        return;
    }

    uploadTargets.set(uuid, target);
}

export async function deleteUploadTarget(
    redis: UploadRedis | null,
    uuid: string,
) {
    const redisClient = getRedis(redis);
    if (redisClient) {
        await redisClient.del(`docker:plugin:targets:${uuid}`);
        return;
    }

    uploadTargets.delete(uuid);
}
