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
import Repos from '../pages/Repos';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('axios');

// Mock RepoCard
vi.mock('../components/Repos/RepoCard', () => ({
    default: ({ repo }: any) => (
        <div data-testid="repo-card">
            <span>{repo.name}</span>
        </div>
    )
}));

describe('Repos Page', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('renders repository list', async () => {
        const mockRepos = [
            { id: '1', name: 'repo-one', type: 'hosted' },
            { id: '2', name: 'repo-two', type: 'proxy' }
        ];
        (axios.get as any).mockResolvedValue({ data: mockRepos });

        renderWithProviders(<Repos />);

        await waitFor(() => {
            expect(screen.getByText('repo-one')).toBeInTheDocument();
            expect(screen.getByText('repo-two')).toBeInTheDocument();
        });

        expect(screen.getAllByTestId('repo-card')).toHaveLength(2);
    });

    it('renders empty state when no repositories', async () => {
        (axios.get as any).mockResolvedValue({ data: [] });

        renderWithProviders(<Repos />);

        await screen.findByText('No repositories found');
        expect(screen.queryByTestId('repo-card')).not.toBeInTheDocument();
    });

    it('filters repositories by search', async () => {
        const mockRepos = [
            { id: '1', name: 'alpha-repo', type: 'hosted' },
            { id: '2', name: 'beta-repo', type: 'proxy' }
        ];
        (axios.get as any).mockResolvedValue({ data: mockRepos });

        renderWithProviders(<Repos />);

        await screen.findByText('alpha-repo');

        const searchInput = screen.getByPlaceholderText('Filter repositories...');
        fireEvent.change(searchInput, { target: { value: 'beta' } });

        expect(screen.queryByText('alpha-repo')).not.toBeInTheDocument();
        expect(screen.getByText('beta-repo')).toBeInTheDocument();
    });
});
