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

import { renderWithProviders, screen, fireEvent } from '../test-utils';
import RepoCard from '../components/Repos/RepoCard';
import { vi } from 'vitest';

describe('RepoCard', () => {
    const mockRepo = {
        id: 'test-repo',
        type: 'hosted',
        manager: 'docker',
        config: {}
    };
    const mockOnDelete = vi.fn();

    it('renders repo details', () => {
        renderWithProviders(<RepoCard repo={mockRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText('test-repo')).toBeInTheDocument();
        expect(screen.getByText('docker')).toBeInTheDocument();
    });

    it('does not duplicate the repo content in the card', () => {
        renderWithProviders(<RepoCard repo={mockRepo} onDelete={mockOnDelete} />);
        const titles = screen.queryAllByText('test-repo');
        // should only render the title once in a single card
        expect(titles).toHaveLength(1);
    });

    it('calls onDelete when delete is clicked', () => {
        renderWithProviders(<RepoCard repo={mockRepo} onDelete={mockOnDelete} />);

        // Open menu
        const menuButton = screen.getByTestId('repo-card-menu');
        // Actually, let's try to find by icon or just click the button
        // Joy UI MenuButton might be tricky to target without aria-label.
        // Let's assume we can find it.
        fireEvent.click(menuButton);

        // Click delete
        const deleteOption = screen.getByText('Delete');
        fireEvent.click(deleteOption);

        expect(mockOnDelete).toHaveBeenCalledWith('test-repo');
    });

    it('renders docker version without double v (supports both "v2" and "2")', () => {
        const withV = { ...mockRepo, config: { docker: { version: 'v2' } } };
        const withoutV = { ...mockRepo, config: { docker: { version: '2' } } };

        const { unmount } = renderWithProviders(<RepoCard repo={withV} onDelete={mockOnDelete} />);
        expect(screen.getByText('v2')).toBeInTheDocument();

        // unmount and render with version that lacks leading v
        unmount();
        renderWithProviders(<RepoCard repo={withoutV} onDelete={mockOnDelete} />);
        expect(screen.getByText('v2')).toBeInTheDocument();
    });

    it('prefers API-provided accessUrl when present (docker host:port)', () => {
        const apiRepo = { ...mockRepo, manager: 'docker', accessUrl: 'http://localhost:5012', config: { docker: {} } };
        renderWithProviders(<RepoCard repo={apiRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText('http://localhost:5012')).toBeInTheDocument();
    });

    it('renders plugin icon when repo.icon is provided', () => {
        const repoWithIcon = { id: 'i1', name: 'i1', type: 'hosted', manager: 'npm', config: {}, icon: '/plugins/npm/icon' };
        renderWithProviders(<RepoCard repo={repoWithIcon} onDelete={mockOnDelete} />);
        const img = screen.getByAltText('npm icon') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.src).toContain('/api/plugins/npm/icon');
    });

    it('falls back to plugin icon based on manager when repo.icon is missing', () => {
        const repoNoIcon = { id: 'm1', name: 'm1', type: 'hosted', manager: 'maven', config: {} };
        renderWithProviders(<RepoCard repo={repoNoIcon} onDelete={mockOnDelete} />);
        const img = screen.getByAltText('maven icon') as HTMLImageElement;
        expect(img).toBeInTheDocument();
        expect(img.src).toContain('/api/plugins/maven/icon');
    });

    it('shows host:port for docker when backend provided a relative /repository path but repo has docker port', () => {
        const apiRepo = { ...mockRepo, manager: 'docker', accessUrl: '/repository/e2e-docker-multipart', config: { docker: { port: 5010 } } };
        renderWithProviders(<RepoCard repo={apiRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText('http://localhost:5010')).toBeInTheDocument();
        // ensure we don't show the relative repository subpath
        expect(screen.queryByText('/repository/e2e-docker-multipart')).toBeNull();
    });

    it('shows informative message when docker repo has no port/accessUrl', () => {
        const noPortRepo = { ...mockRepo, manager: 'docker', config: {} };
        renderWithProviders(<RepoCard repo={noPortRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText(/Docker repositories are served via a dedicated registry host:port/i)).toBeInTheDocument();
    });

    it('shows upstream status for proxy repos when available', () => {
        const now = Date.now();
        const proxyRepo = { id: 'p1', name: 'p1', type: 'proxy', manager: 'docker', config: {}, upstreamStatus: { ok: true, ts: now } };
        renderWithProviders(<RepoCard repo={proxyRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText(/Upstream OK/i)).toBeInTheDocument();
    });

    it('shows unchecked when proxy has no upstreamStatus', () => {
        const proxyRepo = { id: 'p2', name: 'p2', type: 'proxy', manager: 'docker', config: {} };
        renderWithProviders(<RepoCard repo={proxyRepo} onDelete={mockOnDelete} />);
        expect(screen.getByText(/Unchecked/i)).toBeInTheDocument();
    });

    // 'Open registry' option intentionally removed from the card UI — copy-only remains.

    it('does not show Upload action for docker repos even when user has upload permission', () => {
        // simulate user with repo.write global permission
        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'u', permissions: ['repo.write'] }));

        const dockerRepo = { ...mockRepo, manager: 'docker', type: 'hosted' };
        renderWithProviders(<RepoCard repo={dockerRepo} onDelete={mockOnDelete} />);

        const menuButton = screen.getByTestId('repo-card-menu');
        fireEvent.click(menuButton);

        expect(screen.queryByText('Upload')).toBeNull();
        // divider should not be present if there are no items below
        expect(screen.queryByRole('separator')).toBeNull();
    });

    it('shows Upload action for hosted non-docker repos when user can upload', async () => {
        // simulate user with write permissions
        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'u', permissions: ['repo.write'] }));

        const npmRepo = { id: 'npm-1', type: 'hosted', manager: 'npm', config: {} };
        renderWithProviders(<RepoCard repo={npmRepo} onDelete={mockOnDelete} />);

        const menuButton = screen.getByTestId('repo-card-menu');
        fireEvent.click(menuButton);

        const uploadItem = await screen.findByText('Upload');
        expect(uploadItem).toBeInTheDocument();
        // divider should be present when upload is shown
        expect(screen.queryByRole('separator')).not.toBeNull();
    });

    it('navigates to admin repo settings when user has manage permission and in admin context', async () => {
        // simulate an admin user with manage permission
        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'u', permissions: ['repo.manage'] }));

        const npmRepo = { id: 'npm-1', type: 'hosted', manager: 'npm', config: {} };
        renderWithProviders(<RepoCard repo={npmRepo} onDelete={mockOnDelete} />);

        const menuButton = screen.getByTestId('repo-card-menu');
        fireEvent.click(menuButton);

        // Settings should render as a Link pointing to /admin/repos/:name and set state.tab=2
        const settingsItem = await screen.findByText('Settings');
        expect(settingsItem).toBeInTheDocument();

        // MenuItem rendered via react-router Link should be an anchor with expected href
        const anchor = settingsItem.closest('a');
        expect(anchor).not.toBeNull();
        expect(anchor?.getAttribute('href')).toBe('/admin/repos/npm-1');
    });
});
