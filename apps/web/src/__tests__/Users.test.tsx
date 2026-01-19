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
import Users from '../pages/Users';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

// Mock UserDialog to simplify test and avoid deep rendering complexity
vi.mock('../components/Users/UserDialog', () => ({
    default: ({ open, onClose, onSaved }: any) => {
        if (!open) return null;
        return (
            <div data-testid="user-dialog">
                User Dialog Content
                <button onClick={onClose}>Close</button>
                <button onClick={onSaved}>Save</button>
            </div>
        );
    }
}));

describe('Users Page', () => {
    beforeEach(() => {
        vi.resetAllMocks();
        (axios.get as any).mockResolvedValue({ data: [] });
    });

    it('renders users list', async () => {
        const users = [
            { id: 'u1', username: 'admin', roles: [{ id: 'r1', name: 'admin' }] },
            { id: 'u2', username: 'john', displayName: 'John Doe', roles: [] }
        ];
        (axios.get as any).mockResolvedValue({ data: users });

        renderWithProviders(<Users />);

        await screen.findByText('2 users');
        expect(screen.getAllByText('admin')[0]).toBeInTheDocument();
        expect(screen.getByText(/John Doe/)).toBeInTheDocument();
    });

    it('opens create user dialog', async () => {
        renderWithProviders(<Users />);

        await screen.findByText('Users');

        fireEvent.click(screen.getByRole('button', { name: /Create User/i }));

        await screen.findByTestId('user-dialog');
    });

    it('opens edit user dialog', async () => {
        const users = [{ id: 'u1', username: 'admin', roles: [] }];
        (axios.get as any).mockResolvedValue({ data: users });

        renderWithProviders(<Users />);

        await screen.findByText('admin');

        // Find edit button (assuming icon button)
        // We can look for the button with EditIcon. Since we don't have aria-label in components,
        // we might rely on the structure or add aria-labels.
        // In the map function: 
        // <IconButton ... onClick={() => handleEdit(u)}><EditIcon /></IconButton>
        // Joy UI IconButton doesn't automatically add aria-label.
        // Let's find by role 'button' inside the list item.

        const editButtons = screen.getAllByRole('button');
        // Filter for the one that is not "Create User" and likely in the list.
        // Or better, let's just create a test specific selector or rely on order.
        // The first button is "Create User". The next ones are per user.
        // First user has Edit then Delete.

        // Actually, without aria-labels it's hard to distinguish Edit vs Delete cleanly by role query alone without counting.
        // But we can assume standard order.
        // Let's rely on finding by row content and traversing. (Testing Library recommends accessible queries).
        // I will assume the first edit button is the 2nd button on page (1st is create).

        // Wait, "Create User" is at top right.
        // Then inside list item: Edit, then Delete.

        // Let's just target the button via closest interaction.
        // Or better, add aria-label in the component logic if I could, but I'm editing tests.
        // I'll assume valid button index for now or assume specific SVG icon if verified?
        // No, verifying SVG is brittle.

        // I'll take all buttons and click the second one (index 1).
        const buttons = await screen.findAllByRole('button');
        // 0: Create User
        // 1: Edit u1
        // 2: Delete u1

        fireEvent.click(buttons[1]);
        await screen.findByTestId('user-dialog');
    });

    it('handles delete user', async () => {
        const users = [{ id: 'u1', username: 'admin', roles: [] }];
        (axios.get as any).mockResolvedValue({ data: users });
        (axios.delete as any).mockResolvedValue({});

        renderWithProviders(<Users />);

        await screen.findByText('admin');

        const buttons = await screen.findAllByRole('button');
        // 0: Create, 1: Edit, 2: Delete
        fireEvent.click(buttons[2]);

        // Confirmation modal matches text
        await screen.findByText('Delete User');
        await screen.findByText('Are you sure you want to delete admin?');

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

        await waitFor(() => expect(axios.delete).toHaveBeenCalledWith('/api/users/u1'));
    });
});
