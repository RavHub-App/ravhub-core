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

import React from 'react';
import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils';
import RepoDetails from '../pages/RepoDetails';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useAuth } from '../contexts/AuthContext';

// Mock dependencies
vi.mock('axios');

const mockRepo = {
    id: 'my-repo',
    name: 'my-repo',
    type: 'hosted',
    manager: 'npm',
    config: { authEnabled: true }
};

// Mock react-router-dom by importing actual and overriding hooks
// IMPORTANT: extensive mocking ensures renderWithProviders (which uses BrowserRouter) continues to work
// by exporting BrowserRouter as a pass-through
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        BrowserRouter: ({ children }: any) => <div>{children}</div>, // Mock Router used in test-utils
        useParams: () => ({ name: 'my-repo' }),
        useNavigate: () => vi.fn(),
        // Mock useLocation to return null state so component fetches fresh data
        useLocation: () => ({ pathname: '/admin/repos/my-repo', state: null }),
    };
});

// Mock sub-components to reduce noise
vi.mock('../components/Repos/RepoBrowse', () => ({
    default: () => <div data-testid="repo-browse">RepoBrowse</div>
}));
vi.mock('../components/Repos/RepoUpload', () => ({
    default: () => <div data-testid="repo-upload">RepoUpload</div>
}));
vi.mock('../components/Repos/RepositoryPermissions', () => ({
    default: () => <div data-testid="repo-permissions">RepoPermissions</div>
}));

// Mock AuthContext
vi.mock('../contexts/AuthContext', async () => {
    const actual = await vi.importActual('../contexts/AuthContext');
    return {
        ...actual,
        useAuth: () => ({
            user: { id: 'admin', role: 'admin' },
            loading: false
        }),
    };
});

// Mock repo permissions
vi.mock('../components/Repos/repo-permissions', () => ({
    canPerformOnRepo: () => true,
    hasGlobalPermission: () => true
}));

describe('RepoDetails', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/repository/my-repo') return Promise.resolve({ data: mockRepo });
            // API calls for settings/etc
            if (url === '/api/plugins/npm/ping') return Promise.resolve({ data: { result: { capabilities: { configSchema: {} } } } });
            if (url === '/api/storage/configs') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: {} });
        });
    });

    it('fetches and displays repository details', async () => {
        renderWithProviders(<RepoDetails />);

        // Wait for axios call
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/repository/my-repo'));

        // Wait for rendering
        await waitFor(() => {
            // 'my-repo' appears in Breadcrumbs AND Title, so we expect multiple
            expect(screen.getAllByText('my-repo').length).toBeGreaterThan(0);
            expect(screen.getByText('hosted')).toBeInTheDocument();
            expect(screen.getByText('npm')).toBeInTheDocument();
        });
    });

    it('renders tabs correctly for admin user', async () => {
        renderWithProviders(<RepoDetails />);
        await waitFor(() => {
            const titles = screen.getAllByText('my-repo');
            expect(titles.length).toBeGreaterThan(0);
        });

        expect(screen.getByText('Browse')).toBeInTheDocument();
        expect(screen.getByText('Upload')).toBeInTheDocument();
        expect(screen.getByText('Permissions')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('handles delete action', async () => {
        (axios.delete as any).mockResolvedValue({});

        renderWithProviders(<RepoDetails />);
        await waitFor(() => {
            expect(screen.getAllByText('my-repo').length).toBeGreaterThan(0);
        });

        const deleteBtn = screen.getByLabelText('Delete Repository');
        fireEvent.click(deleteBtn);

        await waitFor(() => screen.getByText(/Are you sure you want to delete repository/i));

        // Find generic Confirm/Delete button in modal
        const confirmBtn = screen.getAllByRole('button').find(b =>
            b.textContent?.toLowerCase().includes('delete') ||
            b.textContent?.toLowerCase().includes('confirm')
        );
        if (!confirmBtn) throw new Error("Confirm button not found");
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(axios.delete).toHaveBeenCalledWith('/api/repository/my-repo');
        });
    });

    it('renders Browse tab content by default', async () => {
        renderWithProviders(<RepoDetails />);
        await waitFor(() => {
            expect(screen.getAllByText('my-repo').length).toBeGreaterThan(0);
        });
        expect(screen.getByTestId('repo-browse')).toBeInTheDocument();
    });
});
