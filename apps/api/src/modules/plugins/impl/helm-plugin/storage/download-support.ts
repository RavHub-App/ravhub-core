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
import { buildKey } from '../utils/key-utils';
import { resolveHelmRepo, type HelmRepository } from './helpers';

export type HelmDownloadResult = {
    ok: boolean;
    message?: string;
    data?: Buffer;
    contentType?: string;
};

type ProxyFetchResponse = {
    ok?: boolean;
    body?: Buffer;
    headers?: Record<string, string>;
};

type ProxyHelper = (
    repo: HelmRepository,
    url: string,
) => Promise<ProxyFetchResponse>;

export function loadHelmProxyHelper() {
    try {
        return require('../../../../../plugins-core/proxy-helper')
            .default as ProxyHelper;
    } catch (error) {
        console.warn('[HelmPlugin] Failed to load proxy-helper:', error);
        return null;
    }
}

export async function downloadFromHelmGroup(
    context: PluginContext,
    repo: HelmRepository,
    packageName: string,
    downloadImpl: (
        repo: HelmRepository,
        packageName: string,
        visited: Set<string>,
    ) => Promise<HelmDownloadResult>,
    visited: Set<string>,
): Promise<HelmDownloadResult> {
    const members: string[] = repo.config?.members ?? [];
    if (!Array.isArray(members) || members.length === 0) {
        return { ok: false, message: 'Not found' };
    }

    const key = String(repo.id || repo.name || '');
    if (key) {
        visited.add(key);
    }

    for (const memberId of members) {
        const child = await resolveHelmRepo(context, memberId);
        if (!child) {
            continue;
        }

        const childKey = String(child.id || child.name || '');
        if (childKey && visited.has(childKey)) {
            continue;
        }

        const result = await downloadImpl(
            child as HelmRepository,
            packageName,
            visited,
        );
        if (result.ok) {
            return result;
        }
    }

    return { ok: false, message: 'Not found' };
}

export async function downloadFromHelmProxy(
    context: PluginContext,
    repo: HelmRepository,
    packageName: string,
    proxyFetchWithAuth: ProxyHelper,
): Promise<HelmDownloadResult> {
    const upstream = repo.config?.url;
    if (!upstream) {
        return { ok: false, message: 'No upstream URL' };
    }

    const cleanUpstream = upstream.endsWith('/')
        ? upstream.slice(0, -1)
        : upstream;
    const targetUrl = `${cleanUpstream}/${packageName}`;
    const proxyKey = buildKey('helm', repo.id, 'proxy', packageName);
    const lockKey = `helm:${repo.id}:${packageName}`;

    return runWithLock(context, lockKey, async () => {
        const cachedResult = await readHelmProxyCache(
            context,
            proxyKey,
            packageName,
        );
        if (cachedResult) {
            return cachedResult;
        }

        try {
            const response = await proxyFetchWithAuth(repo, targetUrl);
            if (!(response.ok && response.body)) {
                return { ok: false, message: 'Not found' };
            }

            await saveHelmProxyArtifact(
                context,
                repo,
                packageName,
                proxyKey,
                response.body,
            );
            return {
                ok: true,
                data: response.body,
                contentType:
                    response.headers?.['content-type'] || 'application/octet-stream',
            };
        } catch (error) {
            console.warn(
                `[HelmPlugin] Upstream fetch failed for ${packageName}: ${String(error)}`,
            );
            return { ok: false, message: 'Not found' };
        }
    });
}

export async function downloadHostedHelmArtifact(
    context: PluginContext,
    repo: HelmRepository,
    packageName: string,
): Promise<HelmDownloadResult> {
    if (packageName === 'index.yaml') {
        const key = buildKey('helm', repo.id, 'index.yaml');
        try {
            const content = await context.storage.get(key);
            if (!content) {
                return { ok: false, message: 'Not found' };
            }

            return { ok: true, data: content, contentType: 'application/x-yaml' };
        } catch (error) {
            console.warn(
                `[HelmPlugin] Failed to read index.yaml for ${repo.id}: ${String(error)}`,
            );
            return { ok: false, message: 'Not found' };
        }
    }

    const key = buildKey('helm', repo.id, packageName);
    if (!(await context.storage.exists(key))) {
        return { ok: false, message: 'Not found' };
    }

    const content = await context.storage.get(key);
    if (!content) {
        return { ok: false, message: 'Not found' };
    }

    return { ok: true, data: content, contentType: 'application/gzip' };
}

async function readHelmProxyCache(
    context: PluginContext,
    proxyKey: string,
    packageName: string,
) {
    try {
        const cached = await context.storage.get(proxyKey);
        if (!cached) {
            return null;
        }

        return {
            ok: true,
            data: cached,
            contentType: 'application/octet-stream',
        } satisfies HelmDownloadResult;
    } catch (error) {
        console.warn(
            `[HelmPlugin] Failed to read proxy cache for ${packageName}: ${String(error)}`,
        );
        return null;
    }
}

async function saveHelmProxyArtifact(
    context: PluginContext,
    repo: HelmRepository,
    packageName: string,
    proxyKey: string,
    body: Buffer,
) {
    const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
    if (cacheMaxAgeDays <= 0) {
        return;
    }

    await context.storage.save(proxyKey, body);
    if (!(context.indexArtifact && packageName.endsWith('.tgz'))) {
        return;
    }

    try {
        await context.indexArtifact(repo as never, {
            ok: true,
            id: packageName,
            metadata: {
                storageKey: proxyKey,
                size: body.length,
                path: packageName,
            },
        });
    } catch (error) {
        console.warn(
            `[HelmPlugin] Failed to index proxied chart ${packageName}: ${String(error)}`,
        );
    }
}
