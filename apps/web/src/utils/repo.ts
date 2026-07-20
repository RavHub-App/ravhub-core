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

export function getRepoAccessUrl(repo: any, origin = typeof window !== 'undefined' ? window.location.origin : ''): string | null | undefined {
    if (!repo) return undefined;

    const dockerHost = repo?.config?.docker?.host;
    const dockerPort = repo?.config?.docker?.port;
    const dockerProto = repo?.config?.docker?.protocol || 'https';

    if ((repo?.manager || '').toLowerCase() === 'docker' && dockerHost) {
        // When a custom host is configured (e.g. reverse proxy), show only the host in the UI.
        // Port is an internal detail handled by the proxy.
        return `${dockerProto}://${dockerHost}`;
    }

    const apiAccessUrl = repo.accessUrl && typeof repo.accessUrl === 'string' ? repo.accessUrl.trim() : null;
    if (apiAccessUrl) {
        try {
            new URL(apiAccessUrl);
            return apiAccessUrl;
        } catch {
            if (origin) return `${origin}${apiAccessUrl}`;
            return apiAccessUrl;
        }
    }

    const routeName = repo?.name || repo?.id;

    if ((repo?.manager || '').toLowerCase() === 'docker') {
        if (!dockerPort) return null;
        if (origin) {
            try {
                const parsed = new URL(origin);
                return `${parsed.protocol}//${parsed.hostname}:${dockerPort}`;
            } catch {
                return `:${dockerPort}`;
            }
        }
        if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:${dockerPort}`;
        return `:${dockerPort}`;
    }

    return routeName ? `${origin}/repository/${routeName}` : undefined;
}

export default getRepoAccessUrl;
