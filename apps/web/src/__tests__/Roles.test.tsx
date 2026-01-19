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
import { renderWithProviders, screen, fireEvent, waitFor, within } from '../test-utils';
import Roles from '../pages/Roles';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

// Mock Joy UI Modal to avoid portal issues in testing
vi.mock('@mui/joy', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual as any,
        Modal: ({ open, children }: any) => open ? <div data-testid="mock-modal">{children}</div> : null,
        ModalDialog: ({ children }: any) => <div>{children}</div>,
    };
});

describe('Roles Page', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        // Default mocks
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/rbac/roles') {
                return Promise.resolve({ data: [] });
            }
            if (url === '/api/rbac/permissions') {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: {} });
        });
    });

    it('renders empty state correctly', async () => {
        renderWithProviders(<Roles />);

        await screen.findByText('Roles & Permissions');
        expect(screen.getByText('No roles found')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create Role/i })).toBeEnabled();
    });

    it('renders roles list and permissions', async () => {
        const mockRoles = [
            {
                id: 'r1',
                name: 'Developer',
                description: 'Can read and write',
                permissions: [
                    { id: 'p1', key: 'repos.read' },
                    { id: 'p2', key: 'repos.write' }
                ]
            }
        ];

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/rbac/roles') return Promise.resolve({ data: mockRoles });
            if (url === '/api/rbac/permissions') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: {} });
        });

        renderWithProviders(<Roles />);

        await screen.findByText('Developer');
        expect(screen.getByText('Can read and write')).toBeInTheDocument();
        expect(screen.getByText('repos.read')).toBeInTheDocument();
        expect(screen.getByText('repos.write')).toBeInTheDocument();
    });

    it('creates a new role', async () => {
        const mockPermissions = [
            { id: 'p1', key: 'system.admin', description: 'Admin access' },
            { id: 'p2', key: 'repos.read', description: 'Read repos' }
        ];

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/rbac/roles') return Promise.resolve({ data: [] });
            if (url === '/api/rbac/permissions') return Promise.resolve({ data: mockPermissions });
            return Promise.resolve({ data: {} });
        });
        (axios.post as any).mockResolvedValue({ data: { id: 'r2', name: 'New Role' } });

        renderWithProviders(<Roles />);
        await screen.findByText('Roles & Permissions');

        // Open dialog
        fireEvent.click(screen.getByRole('button', { name: /Create Role/i }));

        // Check for dialog form by waiting for the label
        await screen.findByText('Role Name');

        // Fill form
        fireEvent.change(screen.getByPlaceholderText(/e.g., admin/i), { target: { value: 'New Role' } });
        fireEvent.change(screen.getByLabelText(/Description/i), { target: { value: 'Test description' } });

        // Check permissions (grouped by category)
        // We find the checkbox by its label text which renders the key
        expect(screen.getByText('system')).toBeInTheDocument(); // category header

        fireEvent.click(screen.getByText('system.admin'));

        // Submit
        // Submit (find button inside modal to disambiguate from trigger button)
        fireEvent.click(within(screen.getByTestId('mock-modal')).getByRole('button', { name: /Create Role/i }));

        await waitFor(() => {
            expect(axios.post).toHaveBeenCalledWith('/api/rbac/roles', {
                name: 'New Role',
                description: 'Test description',
                permissions: ['system.admin']
            });
        });
    });

    it('edits an existing role', async () => {
        const mockRoles = [
            { id: 'r1', name: 'Editor', permissions: [] }
        ];
        const mockPermissions = [
            { id: 'p1', key: 'content.edit' }
        ];

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/rbac/roles') return Promise.resolve({ data: mockRoles });
            if (url === '/api/rbac/permissions') return Promise.resolve({ data: mockPermissions });
            return Promise.resolve({ data: {} });
        });
        (axios.put as any).mockResolvedValue({ data: { ok: true } });

        renderWithProviders(<Roles />);
        await screen.findByText('Editor');

        // Click edit button
        // Assuming edit is the first button in the actions area
        const editButtons = screen.getAllByRole('button');
        // 0: Create Role
        // 1: Edit r1
        // 2: Delete r1
        fireEvent.click(editButtons[1]);

        await screen.findByText('Edit Role');

        fireEvent.change(screen.getByPlaceholderText(/e.g., admin/i), { target: { value: 'Super Editor' } });

        fireEvent.click(screen.getByText('content.edit'));

        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => {
            expect(axios.put).toHaveBeenCalledWith('/api/rbac/roles/r1', {
                name: 'Super Editor',
                description: '',
                permissions: ['content.edit']
            });
        });
    });

    it('deletes a role', async () => {
        const mockRoles = [
            { id: 'r1', name: 'To Delete', permissions: [] }
        ];

        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/rbac/roles') return Promise.resolve({ data: mockRoles });
            if (url === '/api/rbac/permissions') return Promise.resolve({ data: [] });
            return Promise.resolve({ data: {} });
        });
        (axios.delete as any).mockResolvedValue({ data: { ok: true } });

        renderWithProviders(<Roles />);
        await screen.findByText('To Delete');

        const editButtons = screen.getAllByRole('button');
        // 0: Create Role
        // 1: Edit
        // 2: Delete
        fireEvent.click(editButtons[2]);

        await screen.findByText('Delete Role');
        await screen.findByText(/Are you sure you want to delete/);

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() => {
            expect(axios.delete).toHaveBeenCalledWith('/api/rbac/roles/r1');
        });
    });
});
