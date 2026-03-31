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

import type { PluginContext, Repository } from '../utils/types';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import {
    buildPyPiRepoBaseUrl,
    getPyPiPackageKeys,
    pickPreferredPyPiFile,
} from './storage-helpers';

type ProxyDownloadResult = Awaited<ReturnType<typeof proxyFetchWithAuth>>;

export type DownloadResult = {
    ok?: boolean;
    message?: string;
    data?: Buffer;
    body?: Buffer;
    headers?: Record<string, string>;
    contentType?: string;
    skipCache?: boolean;
};

export function buildSimpleIndexPage(pkgName: string, links: string[]) {
    return Buffer.from(`<!DOCTYPE html>
<html>
<head><title>Links for ${pkgName}</title></head>
<body>
<h1>Links for ${pkgName}</h1>
${links.join('<br/>\n')}
</body>
</html>`);
}

export async function downloadSimpleIndex(
    storage: PluginContext['storage'],
    repo: Repository,
    name: string,
): Promise<DownloadResult> {
    const packageName =
        name === 'simple' ? '' : name.replace('simple/', '').replace(/\/$/, '');

    if (!packageName) {
        return {
            ok: true,
            contentType: 'text/html',
            data: Buffer.from(
                '<!DOCTYPE html><html><body><h1>Simple Index</h1></body></html>',
            ),
        };
    }

    const hostedLinks = await buildHostedSimpleIndex(storage, repo, packageName);
    if (repo.type === 'proxy') {
        const upstreamIndex = await fetchUpstreamSimpleIndex(repo, packageName);
        if (upstreamIndex) {
            return upstreamIndex;
        }
    }

    return {
        ok: true,
        contentType: 'text/html',
        data: buildSimpleIndexPage(packageName, hostedLinks),
    };
}

export async function readHostedArtifact(
    storage: PluginContext['storage'],
    repo: Repository,
    name: string,
    version: string,
): Promise<Buffer | null> {
    const { keyId, keyName } = getPyPiPackageKeys(repo, name, version);

    try {
        return (
            (await readDirectArtifact(storage, keyId, keyName)) ||
            (await readPreferredArtifact(storage, keyId)) ||
            (await readPreferredArtifact(storage, keyName))
        );
    } catch (error) {
        console.warn(
            `[PyPIPlugin] Failed to read artifact ${name}:${version}: ${String(error)}`,
        );
        return null;
    }
}

export async function resolveRepo(
    context: PluginContext,
    id: string,
): Promise<Repository | null> {
    if (!context.getRepo) {
        return null;
    }

    try {
        return ((await context.getRepo(id)) as Repository | null) ?? null;
    } catch (error) {
        console.warn(
            `[PyPIPlugin] Failed to resolve repository ${id}: ${String(error)}`,
        );
        return null;
    }
}

function buildHostedSimpleIndexLinks(
    repo: Repository,
    packageName: string,
    keys: string[],
) {
    const baseUrl = buildPyPiRepoBaseUrl(repo);
    const links: string[] = [];

    keys.forEach((key: string) => {
        const parts = key.split('/');
        if (parts.length < 5) {
            return;
        }

        const version = parts[3];
        const file = parts[4];
        links.push(
            `<a href="${baseUrl}/${packageName}/${version}/${file}">${file}</a>`,
        );
    });

    return links;
}

async function buildHostedSimpleIndex(
    storage: PluginContext['storage'],
    repo: Repository,
    packageName: string,
) {
    const prefix = getPyPiPackageKeys(repo, packageName, '').keyId.replace(
        /\/$/,
        '',
    );

    try {
        const keys = await storage.list(prefix);
        return buildHostedSimpleIndexLinks(repo, packageName, keys);
    } catch (error) {
        console.warn(
            `[PyPIPlugin] Failed to list hosted simple index files for ${packageName}: ${String(error)}`,
        );
        return [];
    }
}

async function fetchUpstreamSimpleIndex(
    repo: Repository,
    packageName: string,
): Promise<DownloadResult | null> {
    const upstream = repo.config?.proxyUrl || repo.config?.url;
    if (!upstream) {
        return null;
    }

    const target = `${String(upstream).replace(/\/$/, '')}/simple/${packageName}/`;
    try {
        const result = (await proxyFetchWithAuth(
            repo,
            target,
        )) as ProxyDownloadResult;
        if (!(result.ok && 'body' in result && result.body)) {
            return null;
        }

        return {
            ok: true,
            contentType: result.headers?.['content-type'] || 'text/html',
            data: Buffer.isBuffer(result.body)
                ? result.body
                : Buffer.from(String(result.body)),
        };
    } catch (error) {
        console.warn(
            `[PyPIPlugin] Failed to fetch upstream simple index for ${packageName}: ${String(error)}`,
        );
        return null;
    }
}

async function readDirectArtifact(
    storage: PluginContext['storage'],
    keyId: string,
    keyName: string,
) {
    const dataById = await Promise.resolve(storage.get(keyId)).catch(() => null);
    if (dataById) {
        return dataById;
    }

    return await Promise.resolve(storage.get(keyName)).catch(() => null);
}

async function readPreferredArtifact(
    storage: PluginContext['storage'],
    directoryKey: string,
) {
    const listedKeys =
        (await Promise.resolve(storage.list(directoryKey)).catch(() => [])) || [];
    const preferredFile = pickPreferredPyPiFile(listedKeys, directoryKey);
    if (!preferredFile) {
        return null;
    }

    return await Promise.resolve(storage.get(preferredFile)).catch(() => null);
}
