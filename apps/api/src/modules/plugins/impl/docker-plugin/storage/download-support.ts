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
import type { Repository } from '../utils/types';
import {
    buildDockerUpstreamBlobUrls,
    createProxyBlobDownloadTask,
    encodeDockerRepositoryName,
    resolveDockerProxyTarget,
} from './download-proxy-support';

type BlobStorage = {
    exists: (key: string) => Promise<boolean>;
    getUrl: (key: string) => Promise<string | undefined>;
};

type ProxyFetch = (
    repo: Repository,
    url: string,
    options?: { skipCache?: boolean },
) => Promise<
    | {
        ok?: boolean;
        status?: number;
        message?: string;
        url?: string;
        storageKey?: string;
        body?: unknown;
    }
    | undefined
>;

type DownloadResult = {
    ok?: boolean;
    status?: number;
    message?: string;
    url?: string;
    storageKey?: string;
    data?: unknown;
};

export function isDigestReference(reference: string) {
    return (
        reference.startsWith('sha256:') ||
        reference.startsWith('sha384:') ||
        reference.startsWith('sha512:')
    );
}

export async function findStoredBlob(
    storage: BlobStorage,
    repo: Repository,
    name: string | string[],
    digest: string,
): Promise<DownloadResult | undefined> {
    const candidates = [
        buildKey('docker', repo.id, name, 'manifests', digest),
        buildKey('docker', repo.id, 'blobs', digest),
        buildKey('docker', repo.id, 'blobs', name, digest),
    ];

    for (const candidate of candidates) {
        try {
            const exists = await storage.exists(candidate);
            if (!exists) {
                continue;
            }

            const url = await storage.getUrl(candidate);
            if (url) {
                return { ok: true, url, storageKey: candidate };
            }
        } catch {
            continue;
        }
    }

    return undefined;
}

export async function revalidateProxyTag(
    proxyFetch: ProxyFetch | null,
    repo: Repository,
    name: string | string[],
    digest: string,
): Promise<DownloadResult | undefined> {
    const target = resolveDockerProxyTarget(repo);
    if (!target) {
        return undefined;
    }

    console.debug('[GETBLOB DEBUG] Revalidate Start', { targetEarly: target });

    const upstreamUrl = `${String(target).replace(/\/$/, '')}/v2/${encodeDockerRepositoryName(name, target, repo)}/manifests/${encodeURIComponent(digest)}`;
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug('[PROXY REVALIDATE TAG]', {
            upstreamUrl,
            originalName: name,
            normalizedName: buildDockerUpstreamBlobUrls(name, target, repo, digest)
                .normalizedName,
        });
    }

    const fetched = await proxyFetch?.(repo, upstreamUrl, { skipCache: true });
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug('[PROXY REVALIDATE TAG RESULT (GETBLOB)]', {
            ok: fetched?.ok,
            status: fetched?.status,
        });
    }

    if (fetched?.ok && (fetched.url || fetched.storageKey || fetched.body)) {
        return {
            ok: true,
            url: fetched.url,
            storageKey: fetched.storageKey,
            data: fetched.body,
        };
    }

    if (
        fetched &&
        !fetched.ok &&
        fetched.status &&
        fetched.status >= 400 &&
        fetched.status < 500
    ) {
        return {
            ok: false,
            status: fetched.status,
            message: fetched.message || 'not found',
        };
    }

    return undefined;
}

export async function fetchProxyBlob(
    proxyFetch: ProxyFetch | null,
    repo: Repository,
    name: string | string[],
    digest: string,
    pendingDownloads: Map<string, Promise<DownloadResult>>,
): Promise<DownloadResult> {
    const target = resolveDockerProxyTarget(repo);
    if (!target) {
        return { ok: false, message: 'not found' };
    }

    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug('[GETBLOB DEBUG] Proxy Fallback', { target });
        console.debug('[GETBLOB PROXY TARGET]', {
            target,
            hasProxyUrl: !!repo?.config?.proxyUrl,
            hasDockerProxyUrl: !!repo?.config?.docker?.proxyUrl,
            hasUpstream: !!repo?.config?.upstream,
            hasDockerUpstream: !!repo?.config?.docker?.upstream,
        });
    }

    const blobCoalesceKey = `docker:${repo.id}:blob:${digest}`;
    const pendingTask = pendingDownloads.get(blobCoalesceKey);
    if (pendingTask) {
        return await pendingTask;
    }

    const fetchTask = createProxyBlobDownloadTask(
        proxyFetch,
        repo,
        name,
        digest,
        target,
        pendingDownloads,
        blobCoalesceKey,
    );

    pendingDownloads.set(blobCoalesceKey, fetchTask);
    return await fetchTask;
}
