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

import React from 'react';
import { renderWithProviders, screen, waitFor, fireEvent } from '../test-utils';
import RepoBrowse from '../components/Repos/RepoBrowse';
import axios from 'axios';
import { vi, describe, it, expect } from 'vitest';

// Mock dependencies
vi.mock('axios');

const mockArtifacts = [
    {
        name: 'pkg1',
        latestVersion: '1.0.0',
        updatedAt: new Date().toISOString()
    },
    {
        name: 'pkg2',
        latestVersion: '2.0.0',
        updatedAt: new Date().toISOString()
    }
];

describe('RepoBrowse', () => {
    it('fetches and displays artifacts', async () => {
        (axios.get as any).mockResolvedValue({ data: mockArtifacts });

        renderWithProviders(<RepoBrowse repoId='repo-1' />);

        await waitFor(() => {
            expect(screen.getByText('pkg1')).toBeInTheDocument();
            expect(screen.getByText('pkg2')).toBeInTheDocument();
        });
    });

    it('handles empty repository', async () => {
        (axios.get as any).mockResolvedValue({ data: [] });

        renderWithProviders(<RepoBrowse repoId='repo-empty' />);

        await waitFor(() => {
            expect(screen.getByText(/No packages found/i)).toBeInTheDocument();
        });
    });

    it('handles search filtering', async () => {
        (axios.get as any).mockResolvedValue({ data: mockArtifacts });

        renderWithProviders(<RepoBrowse repoId='repo-1' />);

        await waitFor(() => {
            expect(screen.getByText('pkg1')).toBeInTheDocument();
        });

        const searchInput = screen.getByPlaceholderText(/search/i);
        fireEvent.change(searchInput, { target: { value: 'pkg1' } });

        await waitFor(() => {
            expect(screen.getByText('pkg1')).toBeInTheDocument();
            expect(screen.queryByText('pkg2')).not.toBeInTheDocument();
        });
    });
});
