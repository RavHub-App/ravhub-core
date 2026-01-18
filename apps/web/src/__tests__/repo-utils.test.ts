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

import { getRepoAccessUrl } from '../utils/repo'

describe('getRepoAccessUrl', () => {
    it('returns API-provided accessUrl if present', () => {
        const repo = { accessUrl: 'http://custom:5000', manager: 'docker', config: { docker: { port: 5010 } } };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBe('http://custom:5000');
    });

    it('returns host:port for docker when origin provided and port present', () => {
        const repo = { manager: 'docker', config: { docker: { port: 5010 } } };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBe('http://localhost:5010');
    });

    it('returns null for docker if no port and no api accessUrl', () => {
        const repo = { manager: 'docker', config: {} };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBeNull();
    });

    it('returns repository path for non-docker repositories', () => {
        const repo = { name: 'my-repo', manager: 'npm' };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBe('http://localhost:5173/repository/my-repo');
    });

    it('prefers host:port for docker when backend returns a relative repository path', () => {
        const repo = { name: 'my-repo', manager: 'docker', accessUrl: '/repository/my-repo', config: { docker: { port: 5010 } } };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBe('http://localhost:5010');
    });

    it('normalizes relative api accessUrl for non-docker by prefixing origin', () => {
        const repo = { name: 'my-repo', manager: 'npm', accessUrl: '/repository/my-repo' };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBe('http://localhost:5173/repository/my-repo');
    });

    it('returns undefined when repo has no name/id and not docker', () => {
        const repo = { manager: 'npm' };
        expect(getRepoAccessUrl(repo, 'http://localhost:5173')).toBeUndefined();
    });
});
