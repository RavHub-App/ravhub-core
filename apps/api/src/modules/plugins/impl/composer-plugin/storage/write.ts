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

import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import {
    applyComposerPathMetadata,
    getBufferFromPkg,
    handleComposerGroupWrite,
    readRequestBuffer,
} from './storage-helpers';
import {
    buildComposerUploadResult,
    canStreamComposerUpload,
    hasComposerRedeployConflict,
    indexComposerArtifact,
    parseComposerPackageBody,
    uploadComposerStream,
} from './write-support';

export type ComposerPackage = {
    content?: unknown;
    encoding?: string;
    name?: string;
    version?: string;
};

type ComposerConfig = {
    allowRedeploy?: boolean;
};

type SaveResult = {
    size?: number;
    contentHash?: string;
};

export type StorageRequest = {
    body?: unknown;
    buffer?: unknown;
    [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
};

export type ComposerDownloadResult = {
    ok?: boolean;
    id?: string;
    message?: string;
    data?: Buffer | string;
    contentType?: string;
    metadata?: {
        name: string;
        version: string;
        storageKey: string;
        size?: number;
        contentHash?: string;
    };
};

export function createComposerUploader(context: PluginContext) {
    const { storage } = context;

    const upload = async (
        repo: Repository,
        pkg: ComposerPackage,
    ): Promise<ComposerDownloadResult> => {
        if (repo.type === 'group') {
            return handleComposerGroupWrite(context, repo, pkg, upload);
        }

        const name = pkg.name || 'vendor/package';
        const version = pkg.version || '0.0.1';
        const storageVersion = version.endsWith('.zip')
            ? version
            : `${version}.zip`;
        const storageKey = buildKey('composer', repo.id, name, storageVersion);
        const composerConfig = (repo.config ?? {}) as ComposerConfig;

        if (
            composerConfig.allowRedeploy === false &&
            (await hasComposerRedeployConflict(storage, repo, name, storageVersion))
        ) {
            return {
                ok: false,
                message: `Redeployment of ${name}:${version} is not allowed`,
            };
        }

        const buffer = getBufferFromPkg(pkg);

        try {
            const saveResult = (await storage.save(storageKey, buffer)) as SaveResult;
            const result = buildComposerUploadResult(
                name,
                version,
                storageKey,
                saveResult,
                buffer.length,
            );
            await indexComposerArtifact(context, repo, result);
            return result;
        } catch (error) {
            return { ok: false, message: String(error) };
        }
    };

    return upload;
}

export function createComposerPutHandler(
    context: PluginContext,
    upload: (
        repo: Repository,
        pkg: ComposerPackage,
    ) => Promise<ComposerDownloadResult>,
) {
    return async (
        repo: Repository,
        path: string,
        req: StorageRequest,
    ): Promise<ComposerDownloadResult> => {
        if (repo.type === 'group') {
            const buffer = await readRequestBuffer(req);
            const delegatedRequest: StorageRequest = {
                ...req,
                body: buffer,
                buffer,
            };
            return handleComposerGroupWrite(
                context,
                repo,
                { content: buffer },
                (member) =>
                    createComposerPutHandler(context, upload)(
                        member,
                        path,
                        delegatedRequest,
                    ),
            );
        }

        if (canStreamComposerUpload(context.storage, path, req)) {
            return uploadComposerStream(context, repo, path, req);
        }

        const buffer = await readRequestBuffer(req);
        const pkg = applyComposerPathMetadata(
            path,
            parseComposerPackageBody(buffer),
        );
        return upload(repo, pkg);
    };
}
