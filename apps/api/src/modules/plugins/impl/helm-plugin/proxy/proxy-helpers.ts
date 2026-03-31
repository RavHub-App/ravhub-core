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

import * as yaml from 'js-yaml';
import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import type { ProxyFetchResult } from '../../../../../plugins-core/proxy-helper';

export type HelmProxyResult = ProxyFetchResult<Buffer | string>;

export type HelmRepository = {
    id: string;
    name?: string;
    type?: string;
    manager?: string;
    config?: Record<string, unknown> & {
        cacheEnabled?: boolean;
        proxyUrl?: string;
        url?: string;
    };
};

type HelmIndexEntry = {
    urls?: string[];
};

type HelmIndex = {
    entries?: Record<string, HelmIndexEntry[]>;
};

export function toBuffer(body: unknown) {
    return Buffer.isBuffer(body) ? body : Buffer.from(String(body));
}

export function getResponseBody(result: HelmProxyResult) {
    return 'body' in result ? result.body : undefined;
}

export function isChartArchive(url: string) {
    return /(\.tgz|\.tar\.gz)(\?.*)?$/i.test(url);
}

export function isChartRequest(url: string) {
    return /\.(tgz|prov)(\?.*)?$/i.test(url) || url.endsWith('.tar.gz');
}

export function isIndexRequest(url: string) {
    return url.endsWith('index.yaml');
}

export function deriveChartIdentity(filename: string) {
    const archiveName = filename.replace(/(\.tgz|\.tar\.gz)$/i, '');
    const match = archiveName.match(/^(.*)-(\d+\..*)$/);

    if (!match) {
        return {
            name: filename,
            version: '0.0.0',
            filename,
        };
    }

    return {
        name: match[1],
        version: match[2],
        filename,
    };
}

export function createMagicProxyCacheKey(
    buildKey: Function,
    repoId: string,
    targetUrl: string,
) {
    const urlForCache = targetUrl.split('#')[0].split('?')[0];
    return {
        urlForCache,
        keyId: buildKey('helm', repoId, 'proxy', 'magic', urlForCache),
    };
}

export function createStandardProxyCacheKey(
    buildKey: Function,
    repoId: string,
    url: string,
) {
    const urlForCache = url.split('#')[0].split('?')[0];
    return {
        urlForCache,
        keyId: buildKey('helm', repoId, 'proxy', 'file', urlForCache),
    };
}

export function buildTargetUrl(repo: HelmRepository, url: string) {
    const upstreamUrl = repo.config?.proxyUrl || repo.config?.url;
    if (url.match(/^https?:\/\//)) {
        return url;
    }

    return `${upstreamUrl?.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

export function decodeMagicProxyUrl(url: string) {
    const encodedUrl = url.replace('helm-proxy/', '');
    return Buffer.from(encodedUrl, 'base64').toString('utf-8');
}

export function createCacheHitResponse(body: Buffer, contentType: string) {
    return {
        ok: true,
        status: 200,
        body,
        headers: {
            'content-type': contentType,
            'x-proxy-cache': 'HIT',
        },
    };
}

export function createMissingBodyResponse(): HelmProxyResult {
    return { ok: false, status: 502, body: 'missing upstream body' };
}

export function rewriteIndexYaml(buffer: Buffer) {
    const index = yaml.load(buffer.toString('utf-8')) as HelmIndex;
    if (!index?.entries) {
        return buffer;
    }

    for (const chartName in index.entries) {
        for (const version of index.entries[chartName]) {
            if (!version.urls) {
                continue;
            }

            version.urls = version.urls.map((item: string) => {
                if (item.match(/^https?:\/\//)) {
                    return `helm-proxy/${Buffer.from(item).toString('base64')}`;
                }
                return item;
            });
        }
    }

    return Buffer.from(yaml.dump(index));
}

export async function tryIndexChartArtifact(
    context: PluginContext,
    repo: HelmRepository,
    storageKey: string,
    url: string,
    body: Buffer,
) {
    if (!context.indexArtifact || !isChartArchive(url)) {
        return;
    }

    const filename = url.split('/').pop() || 'unknown';
    const { name, version } = deriveChartIdentity(filename);

    await context.indexArtifact(repo as never, {
        ok: true,
        id: `${name}:${version}`,
        metadata: {
            name,
            version,
            filename,
            storageKey,
            size: body.length,
        },
    });
}
