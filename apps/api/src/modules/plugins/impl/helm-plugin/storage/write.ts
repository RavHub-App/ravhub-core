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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import * as yaml from 'js-yaml';
import { buildKey } from '../utils/key-utils';
import { handleHelmGroupPut, handleHelmGroupUpload } from './group-write';
import {
    getBufferFromPackage,
    inferChartIdentity,
    readHelmRequestBuffer,
    type HelmPackage,
    type HelmRepository,
    type HelmStorageRequest,
} from './helpers';

type HelmUploadResult = {
    ok: boolean;
    id?: string;
    message?: string;
    metadata?: {
        name?: string;
        version?: string;
        storageKey: string;
        size?: number;
        contentHash?: string;
    };
};

type SaveResult = {
    size?: number;
    contentHash?: string;
};

async function updateIndexYaml(
    context: PluginContext,
    repo: HelmRepository,
    pkg: HelmPackage,
    filename: string,
) {
    const lockKey = `helm:index:${repo.id}`;

    return runWithLock(context, lockKey, async () => {
        const indexKey = buildKey('helm', repo.id, 'index.yaml');
        let index: {
            apiVersion: string;
            entries: Record<string, Array<Record<string, unknown>>>;
        } = {
            apiVersion: 'v1',
            entries: {},
        };

        try {
            const existing = await context.storage.get(indexKey);
            if (existing) {
                index = yaml.load(existing.toString()) as typeof index;
            }
        } catch (error) {
            console.warn(
                `[HelmPlugin] Failed to read existing index.yaml for ${repo.id}: ${String(error)}`,
            );
        }

        const name = pkg.name || 'unknown';
        const version = pkg.version || '0.0.0';
        if (!index.entries[name]) {
            index.entries[name] = [];
        }

        const existingVersion = index.entries[name].find(
            (entry) => entry.version === version,
        );
        if (!existingVersion) {
            index.entries[name].push({
                apiVersion: 'v2',
                name,
                version,
                urls: [filename],
                created: new Date().toISOString(),
            });
        }

        await context.storage.save(indexKey, Buffer.from(yaml.dump(index)));
    });
}

async function indexHelmArtifact(
    context: PluginContext,
    repo: HelmRepository,
    result: HelmUploadResult,
) {
    if (!context.indexArtifact) {
        return;
    }

    try {
        await context.indexArtifact(repo as never, result);
    } catch (error) {
        console.error('[Helm] Failed to index artifact:', error);
    }
}

export function createHelmUploader(context: PluginContext) {
    const upload = async (
        repo: HelmRepository,
        pkg: HelmPackage,
    ): Promise<HelmUploadResult> => {
        if (repo.type === 'group') {
            return handleHelmGroupUpload(context, repo, pkg, upload);
        }

        const buffer = getBufferFromPackage(pkg);
        const filename = pkg.filename || `${pkg.name}-${pkg.version}.tgz`;
        const key = buildKey('helm', repo.id, filename);
        const saveResult = (await context.storage.save(key, buffer)) as SaveResult;

        await updateIndexYaml(context, repo, pkg, filename);

        const result = {
            ok: true,
            id: filename,
            metadata: {
                name: pkg.name || 'unknown',
                version: pkg.version || '0.0.0',
                storageKey: key,
                size: saveResult.size ?? buffer.length,
                contentHash: saveResult.contentHash,
            },
        };

        await indexHelmArtifact(context, repo, result);
        return result;
    };

    return upload;
}

export function createHelmPutHandler(context: PluginContext) {
    const upload = createHelmUploader(context);

    const handlePut = async (
        repo: HelmRepository,
        filePath: string,
        req: HelmStorageRequest,
    ): Promise<HelmUploadResult> => {
        if (repo.type === 'group') {
            return handleHelmGroupPut(context, repo, filePath, req, handlePut);
        }

        if (
            filePath.endsWith('.tgz') &&
            typeof context.storage.saveStream === 'function' &&
            !req.body &&
            !req.buffer
        ) {
            const key = buildKey('helm', repo.id, filePath);

            try {
                const saveResult = (await context.storage.saveStream(
                    key,
                    req,
                )) as SaveResult;
                await updateIndexYaml(
                    context,
                    repo,
                    inferChartIdentity(filePath),
                    filePath,
                );
                return {
                    ok: true,
                    id: filePath,
                    metadata: {
                        storageKey: key,
                        size: saveResult.size,
                        contentHash: saveResult.contentHash,
                    },
                };
            } catch (error) {
                return { ok: false, message: String(error) };
            }
        }

        const bufferedBody = await readHelmRequestBuffer(req);
        return upload(repo, { buffer: bufferedBody, filename: filePath });
    };

    return handlePut;
}
