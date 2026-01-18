/*
 * Copyright (C) 2026 RavHub Team
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

    // If backend provided an accessUrl use it when it's an absolute/complete URL.
    // For docker repositories the server may erroneously return a relative
    // repository path (e.g. '/repository/foo') — that's misleading because
    // docker clients require registry host:port, so prefer per-repo host:port
    // when available.
    const apiAccessUrl = repo.accessUrl && typeof repo.accessUrl === 'string' ? repo.accessUrl.trim() : null;
    if (apiAccessUrl) {
        try {
            // if this is an absolute URL (includes protocol/host) use it
            new URL(apiAccessUrl);
            return apiAccessUrl;
        } catch {
            // relative path returned by server
            if ((repo?.manager || '').toLowerCase() === 'docker') {
                // ignore relative API value for docker; we'll try per-repo port below
            } else {
                // for non-docker repos, make it absolute by prefixing origin when available
                if (origin) return `${origin}${apiAccessUrl}`;
                return apiAccessUrl;
            }
        }
    }

    const dockerPort = repo?.config?.docker?.port;
    const routeName = repo?.name || repo?.id;

    if ((repo?.manager || '').toLowerCase() === 'docker') {
        // for docker, only return a host:port if a specific port is present — falling back
        // to /repository/<name> is misleading because docker clients require registry host:port
        if (!dockerPort) return null;
        // prefer using the provided origin so tests and SSR can control the host/protocol
        if (origin) {
            try {
                const parsed = new URL(origin);
                return `${parsed.protocol}//${parsed.hostname}:${dockerPort}`;
            } catch {
                // if origin is not a valid URL, fall back to plain port-only string
                return `:${dockerPort}`;
            }
        }
        // final fallback: try to use window when available
        if (typeof window !== 'undefined') return `${window.location.protocol}//${window.location.hostname}:${dockerPort}`;
        return `:${dockerPort}`;
    }

    return routeName ? `${origin}/repository/${routeName}` : undefined;
}

export default getRepoAccessUrl;
