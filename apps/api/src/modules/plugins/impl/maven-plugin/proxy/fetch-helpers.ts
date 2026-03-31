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

import {
    parseFilename,
    parseMetadata,
    resolveSnapshotVersion,
} from '../utils/maven';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import type { Repository } from '../utils/types';

type ProxyResponse = Awaited<ReturnType<typeof proxyFetchWithAuth>>;

export type MavenProxyRequest = {
    upstreamRequestUrl: string;
    cleanUrl: string;
    isXml: boolean;
    isArtifact: boolean;
    isMetadata: boolean;
};

export function resolveMavenProxyRequest(url: string): MavenProxyRequest {
    const upstreamRequestUrl = normalizeUpstreamRequestUrl(url);
    const cleanUrl = upstreamRequestUrl;
    const isXml = cleanUrl.endsWith('.xml') || cleanUrl.endsWith('.pom');
    const isMetadata =
        cleanUrl.endsWith('maven-metadata.xml') ||
        cleanUrl.endsWith('.sha1') ||
        cleanUrl.endsWith('.md5') ||
        cleanUrl.endsWith('.asc');

    return {
        upstreamRequestUrl,
        cleanUrl,
        isXml,
        isArtifact: !isXml && !isMetadata,
        isMetadata,
    };
}

export async function resolveSnapshotArtifact(
    repo: Repository,
    upstreamRequestUrl: string,
): Promise<ProxyResponse | null> {
    if (
        !upstreamRequestUrl.includes('-SNAPSHOT') ||
        upstreamRequestUrl.endsWith('maven-metadata.xml')
    ) {
        return null;
    }

    const parts = upstreamRequestUrl.split('/');
    const filename = parts.pop();
    const version = parts.pop();
    const artifactId = parts.pop();
    if (!(version && version.endsWith('-SNAPSHOT') && filename && artifactId)) {
        return null;
    }

    const metadataUrl = [
        ...parts,
        artifactId,
        version,
        'maven-metadata.xml',
    ].join('/');
    const metadataResult = await proxyFetchWithAuth(repo, metadataUrl);
    const xml = extractMetadataXml(metadataResult);
    if (!xml) {
        return null;
    }

    const metadata = parseMetadata(xml);
    const parsedFilename = parseFilename(filename, version, artifactId);
    if (!parsedFilename) {
        return null;
    }

    const resolvedVersion = resolveSnapshotVersion(
        metadata,
        parsedFilename.extension,
        parsedFilename.classifier,
    );
    if (!resolvedVersion) {
        return null;
    }

    let newFilename = `${artifactId}-${resolvedVersion}`;
    if (parsedFilename.classifier) {
        newFilename += `-${parsedFilename.classifier}`;
    }
    newFilename += `.${parsedFilename.extension}${parsedFilename.checksumExt}`;

    const resolvedUrl = [...parts, artifactId, version, newFilename].join('/');
    const result = await proxyFetchWithAuth(repo, resolvedUrl);
    return Object.assign({}, result, { skipCache: true }) as ProxyResponse;
}

function normalizeUpstreamRequestUrl(url: string) {
    let upstreamRequestUrl = url.split('?')[0].split('#')[0];
    if (!upstreamRequestUrl.startsWith('http')) {
        return upstreamRequestUrl;
    }

    try {
        const parsedUrl = new URL(upstreamRequestUrl);
        if (!parsedUrl.pathname.startsWith('/repository/')) {
            return upstreamRequestUrl;
        }

        const parts = parsedUrl.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
            upstreamRequestUrl = parts.slice(2).join('/');
        }
    } catch {
        return upstreamRequestUrl;
    }

    return upstreamRequestUrl;
}

function extractMetadataXml(result: ProxyResponse) {
    if (!(result.ok && 'body' in result && typeof result.body === 'string')) {
        return '';
    }

    return result.body;
}
