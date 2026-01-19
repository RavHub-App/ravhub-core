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
import { renderWithProviders, screen, waitFor } from '../test-utils';
import Dashboard from '../pages/Dashboard';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

describe('Dashboard', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('renders and fetches metrics', async () => {
        const mockMetrics = {
            totalDownloads: 1000,
            totalUploads: 50,
            totalArtifacts: 200,
            totalStorage: 1024 * 1024 * 1024, // 1 GB
            proxyMetrics: {
                hits: 80,
                misses: 20,
                success: 95,
                failure: 5,
                errors: 0,
                durationTotal: 10000
            },
            artifactsByRepo: { 'r1': 10 },
            storageByRepo: { 'r1': { size: 1024 * 100 } },
            downloadsByRepo: { 'r1': 50 },
            recentArtifacts: [
                {
                    id: 'a1',
                    name: 'my-lib',
                    version: '1.0.0',
                    size: 1024,
                    createdAt: new Date().toISOString(),
                    repository: { name: 'npm-hosted', manager: 'npm' }
                }
            ]
        };

        const mockRepos = [
            { id: 'r1', name: 'npm-hosted', type: 'hosted', manager: 'npm' }
        ];

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/monitor/metrics') {
                return Promise.resolve({ data: mockMetrics });
            }
            if (url === '/api/repositories') {
                return Promise.resolve({ data: mockRepos });
            }
            return Promise.resolve({ data: {} });
        });

        renderWithProviders(<Dashboard />);

        await screen.findByText('Dashboard');

        // Check main cards
        await screen.findByText(/1[,.]?000/); // Downloads (wait for fetch)
        const uploads = await screen.findAllByText('50');
        expect(uploads.length).toBeGreaterThan(0);

        const artifacts = await screen.findAllByText('200'); // Artifacts
        expect(artifacts.length).toBeGreaterThan(0);

        await screen.findByText(/1 GB/); // Storage

        // Check proxy metrics
        expect(screen.getByText('80%')).toBeInTheDocument(); // Cache Hit Rate
        expect(screen.getByText('100')).toBeInTheDocument(); // Proxy Requests
        // Verify API calls
        expect(axios.get).toHaveBeenCalledWith('/api/monitor/metrics');
        expect(axios.get).toHaveBeenCalledWith('/api/repositories');

        // Check Repo Stats
        // Check Recent Artifacts (verifies metrics rendering)
        await screen.findByText('my-lib');

        // now check for npm-hosted (it appears in both Repos list and Recent Artifacts)
        expect(screen.getAllByText('npm-hosted').length).toBeGreaterThan(0);

        expect(screen.getAllByText('50').length).toBeGreaterThan(0); // Downloads in activity table
        expect(screen.getByText(/^v1.0.0$/)).toBeInTheDocument();
    });

    it('handles successful metric fetch with empty values', async () => {
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/monitor/metrics') return Promise.resolve({ data: {} });
            if (url === '/api/repositories') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: {} });
        });

        renderWithProviders(<Dashboard />);

        await screen.findByText('Dashboard');

        expect(screen.getAllByText('0').length).toBeGreaterThan(0); // Multiple zero counts
        expect(screen.getByText('0 B')).toBeInTheDocument(); // Storage
        expect(screen.getByText('No repositories yet')).toBeInTheDocument();
        expect(screen.getByText('No artifacts yet')).toBeInTheDocument();
    });
});
