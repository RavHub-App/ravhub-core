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

import * as crypto from 'crypto';
import * as fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';
import {
    deleteUploadMeta,
    deleteUploadTarget,
    getTempFilePath,
    getUploadMeta,
    getUploadTarget,
    setUploadTarget,
} from './upload-session';

type StorageLike = {
    save: (key: string, data: Buffer) => Promise<unknown>;
    saveStream?: (key: string, stream: Readable) => Promise<unknown>;
};

type RedisLike = {
    isEnabled?: () => boolean;
    get?: (key: string) => Promise<string | null>;
    set?: (...args: unknown[]) => Promise<unknown>;
    del?: (key: string) => Promise<unknown>;
} | null;

type GroupAwareOperation = {
    initiateUpload: (repo: Repository, name: string) => Promise<unknown>;
    appendUpload: (
        repo: Repository,
        uuid: string,
        digest?: string,
        buffer?: Buffer,
        stream?: Readable,
    ) => Promise<unknown>;
    finalizeUpload: (
        repo: Repository,
        name: string,
        uuid: string,
        digest?: string,
        buffer?: Buffer,
        stream?: Readable,
    ) => Promise<unknown>;
};

export function createGroupUploadDependencies(
    getRepo: ((id: string) => Promise<Repository | null>) | null,
    redis: RedisLike,
    operations: GroupAwareOperation,
) {
    return {
        getRepo,
        initiateUpload: operations.initiateUpload,
        appendUpload: operations.appendUpload,
        finalizeUpload: operations.finalizeUpload,
        setUploadTarget: (
            uuid: string,
            target: Parameters<typeof setUploadTarget>[2],
        ) =>
            setUploadTarget(redis, uuid, target),
        getUploadTarget: (uuid: string) => getUploadTarget(redis, uuid),
        deleteUploadTarget: (uuid: string) => deleteUploadTarget(redis, uuid),
    };
}

export async function appendHostedUpload(
    redis: RedisLike,
    uuid: string,
    buffer?: Buffer,
    stream?: Readable,
) {
    const filePath = getTempFilePath(uuid);
    const uploadMeta = await getUploadMeta(redis, uuid);
    if (!uploadMeta && !fs.existsSync(filePath)) {
        return { ok: false, message: 'Upload session not found (expired?)' };
    }

    try {
        await appendUploadContent(filePath, buffer, stream, false);
        const stats = fs.statSync(filePath);
        return { ok: true, uploaded: stats.size };
    } catch (error: any) {
        return { ok: false, message: `IO Error: ${error.message}` };
    }
}

export async function finalizeHostedUpload(
    storage: StorageLike,
    redis: RedisLike,
    repo: Repository,
    uuid: string,
    digest?: string,
    buffer?: Buffer,
    stream?: Readable,
) {
    const filePath = getTempFilePath(uuid);

    try {
        await appendUploadContent(filePath, buffer, stream, true);
    } catch (error: any) {
        return {
            ok: false,
            message: `IO Error appending content: ${error.message}`,
        };
    }

    if (!fs.existsSync(filePath)) {
        return { ok: false, message: 'Upload session not found' };
    }

    const size = fs.statSync(filePath).size;
    const digestResult = await resolveUploadDigest(filePath, digest);
    if (!digestResult.ok) {
        fs.unlinkSync(filePath);
        await deleteUploadMeta(redis, uuid);
        return digestResult;
    }

    const key = buildKey('docker', repo.id, `blobs/${digestResult.id}`);
    try {
        const savedResult = await saveUploadBlob(storage, key, filePath);
        fs.unlinkSync(filePath);
        await deleteUploadMeta(redis, uuid);

        const savedMetadata =
            savedResult && typeof savedResult === 'object' ? savedResult : {};

        return {
            ok: true,
            id: digestResult.id,
            metadata: {
                storageKey: key,
                digest: digestResult.id,
                size: (savedMetadata as { size?: number }).size ?? size,
                contentHash: (savedMetadata as { contentHash?: string }).contentHash,
            },
        };
    } catch (error) {
        return { ok: false, message: String(error) };
    }
}

async function appendUploadContent(
    filePath: string,
    buffer: Buffer | undefined,
    stream: Readable | undefined,
    ensureFile: boolean,
) {
    if (ensureFile && !fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, Buffer.alloc(0));
    }

    if (stream) {
        const writeStream = fs.createWriteStream(filePath, { flags: 'a' });
        await pipeline(stream, writeStream);
    }

    if (buffer && buffer.length > 0) {
        if (ensureFile && !fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, Buffer.alloc(0));
        }
        fs.appendFileSync(filePath, buffer);
    }
}

async function resolveUploadDigest(filePath: string, digest?: string) {
    const computedDigest = await computeFileDigest(filePath);
    if (!digest) {
        return { ok: true, id: computedDigest };
    }

    if (computedDigest !== digest) {
        return {
            ok: false,
            message: `Digest mismatch: expected ${digest}, got ${computedDigest}`,
        };
    }

    return { ok: true, id: digest };
}

async function computeFileDigest(filePath: string) {
    const hash = crypto.createHash('sha256');
    const hashStream = fs.createReadStream(filePath);
    await new Promise<void>((resolve, reject) => {
        hashStream.on('data', (data) => hash.update(data));
        hashStream.on('end', () => resolve());
        hashStream.on('error', reject);
    });
    return `sha256:${hash.digest('hex')}`;
}

async function saveUploadBlob(
    storage: StorageLike,
    key: string,
    filePath: string,
) {
    if (typeof storage.saveStream === 'function') {
        const uploadStream = fs.createReadStream(filePath);
        return await storage.saveStream(key, uploadStream);
    }

    const fullBuffer = fs.readFileSync(filePath);
    return await storage.save(key, fullBuffer);
}
