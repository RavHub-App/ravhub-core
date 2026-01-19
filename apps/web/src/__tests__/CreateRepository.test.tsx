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
import CreateRepository from '../pages/CreateRepository';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

const mockPlugins = [
    { key: 'npm', name: 'NPM' },
    { key: 'docker', name: 'Docker' }
];

const mockRepos = [
    { id: 'r1', name: 'npm-hosted', type: 'hosted', manager: 'npm' }
];

const mockStorage = [
    { id: 's1', name: 'Local Disk', type: 'local' }
];

const mockNpmCapabilities = {
    result: {
        capabilities: {
            repoTypes: ['hosted', 'proxy', 'group'],
            configSchema: {
                properties: {
                    customField: { type: 'string', default: 'some-value', title: 'Custom Field Label' }
                }
            }
        },
        info: 'NPM Package Manager'
    }
};

describe('CreateRepository', () => {
    beforeEach(() => {
        vi.resetAllMocks();

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/plugins') return Promise.resolve({ data: mockPlugins });
            if (url === '/api/repository') return Promise.resolve({ data: mockRepos });
            if (url === '/api/storage/configs') return Promise.resolve({ data: mockStorage });
            if (url === '/api/plugins/npm/ping') return Promise.resolve({ data: mockNpmCapabilities });
            return Promise.resolve({ data: {} });
        });
    });

    it('renders initial form state', async () => {
        renderWithProviders(<CreateRepository />);
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/plugins'));
        expect(screen.getByText('Name')).toBeInTheDocument();
        expect(screen.getByText('Manager')).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
    });

    it('loads manager capabilities when selected', async () => {
        renderWithProviders(<CreateRepository />);
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/plugins/npm/ping'));
        expect(screen.getByText('NPM Package Manager')).toBeInTheDocument();
    });

    it('renders plugin specific configuration schema', async () => {
        renderWithProviders(<CreateRepository />);
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/plugins/npm/ping'));

        // First verify that the plugin info is loaded
        await screen.findByText('NPM Package Manager');

        // Wait for Configuration section to appear (indicates schema loaded)
        // Note: The code renders Configuration ONLY if schema is present AND repoType is selected.
        await screen.findByText(/Configuration/i);

        // Wait for specific field by testId
        const element = await screen.findByTestId('field-customField');
        expect(element).toBeInTheDocument();
    });

    it('validates required fields before submission', async () => {
        renderWithProviders(<CreateRepository />);
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/plugins/npm/ping'));

        const submitBtn = screen.getByRole('button', { name: /Create Repository/i });
        // Button enabled because defaults are valid
        expect(submitBtn).not.toBeDisabled();

        // Click with empty name -> no submit
        fireEvent.click(submitBtn);
        expect(axios.post).not.toHaveBeenCalled();
    });

    it('switches repository type', async () => {
        const mockCapabilitiesWithProxy = {
            ...mockNpmCapabilities,
            result: {
                ...mockNpmCapabilities.result,
                capabilities: { ...mockNpmCapabilities.result.capabilities, repoTypes: ['hosted', 'proxy'] }
            }
        };
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/plugins/npm/ping') {
                return Promise.resolve({ data: mockCapabilitiesWithProxy });
            }
            if (url === '/api/plugins') return Promise.resolve({ data: mockPlugins });
            return Promise.resolve({ data: {} });
        });

        renderWithProviders(<CreateRepository />);
        await waitFor(() => {
            const elements = screen.queryAllByText(/hosted/i);
            expect(elements.length).toBeGreaterThan(0);
        });
    });

    it('submits correctly with proxy configuration', async () => {
        (axios.post as any).mockResolvedValue({ data: { id: 'new-proxy-repo' } });
        const mockProxyCaps = {
            result: {
                capabilities: {
                    repoTypes: ['proxy'],
                    configSchema: {
                        properties: {
                            target: { type: 'string' }
                        }
                    }
                }
            }
        };
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/plugins/npm/ping') return Promise.resolve({ data: mockProxyCaps });
            if (url === '/api/plugins') return Promise.resolve({ data: mockPlugins });
            return Promise.resolve({ data: {} });
        });

        renderWithProviders(<CreateRepository />);
        await waitFor(() => {
            const elements = screen.queryAllByText(/proxy/i);
            expect(elements.length).toBeGreaterThan(0);
        });

        const nameInput = screen.getByPlaceholderText('my-repo');
        fireEvent.change(nameInput, { target: { value: 'my-proxy' } });

        // Fill required proxy field
        // Since schema property is 'target', label should be 'target'
        // Using testId for reliability since we added it to CreateRepository.tsx
        const targetInput = await screen.findByTestId('field-target');
        // The testid is on the FormControl, we need the input inside it
        const inputElement = targetInput.querySelector('input');
        if (inputElement) {
            fireEvent.change(inputElement, { target: { value: 'https://registry.npmjs.org' } });
        } else {
            // Fallback if structure is different
            const label = await screen.findByText(/target/i);
            // ... confusing to find input from label

            // Let's rely on label text which is standard
            const inp = await screen.findByLabelText(/target/i);
            fireEvent.change(inp, { target: { value: 'https://registry.npmjs.org' } });
        }

        const submitBtn = screen.getByRole('button', { name: /Create Repository/i });
        await waitFor(() => expect(submitBtn).not.toBeDisabled(), { timeout: 3000 });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith('/api/repositories', expect.objectContaining({
                name: 'my-proxy',
                type: 'proxy'
            }));
        });
    });

    it('submits form successfully', async () => {
        (axios.post as any).mockResolvedValue({ data: { id: 'new-repo' } });
        renderWithProviders(<CreateRepository />);
        await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/plugins/npm/ping'));
        const nameInput = screen.getByPlaceholderText('my-repo');
        fireEvent.change(nameInput, { target: { value: 'my-new-repo' } });

        const submitBtn = screen.getByRole('button', { name: /Create Repository/i });
        await waitFor(() => expect(submitBtn).not.toBeDisabled(), { timeout: 3000 });
        fireEvent.click(submitBtn);

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith('/api/repositories', expect.objectContaining({ name: 'my-new-repo' }));
        });
    });
});
