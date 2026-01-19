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
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import Bootstrap from '../pages/auth/Bootstrap';
import axios from 'axios';
import { useAuth } from '../contexts/AuthContext';
import { vi } from 'vitest';

vi.mock('axios');
vi.mock('../contexts/AuthContext', () => ({
    useAuth: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
    const actual = await vi.importActual('react-router-dom');
    return {
        ...actual,
        useNavigate: () => mockNavigate,
    };
});

describe('Bootstrap Page', () => {
    const mockLogin = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
        (useAuth as any).mockReturnValue({ login: mockLogin });
        // Default: bootstrap check returns required
        (axios.get as any).mockResolvedValue({ data: { ok: true, bootstrapRequired: true } });
    });

    it('redirects to login if bootstrap is not required', async () => {
        (axios.get as any).mockResolvedValue({ data: { ok: true, bootstrapRequired: false } });

        render(
            <BrowserRouter>
                <Bootstrap />
            </BrowserRouter>
        );

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/auth/login'));
    });

    it('renders bootstrap form when required', async () => {
        render(
            <BrowserRouter>
                <Bootstrap />
            </BrowserRouter>
        );

        // Wait for loading to finish
        await screen.findByText('First Admin');

        expect(screen.getByLabelText('Username')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Create admin' })).toBeInTheDocument();
    });

    it('validates password mismatch', async () => {
        render(
            <BrowserRouter>
                <Bootstrap />
            </BrowserRouter>
        );

        await screen.findByText('First Admin');

        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'otherpass' } });

        fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

        await waitFor(() => {
            expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
        });

        expect(axios.post).not.toHaveBeenCalled();
    });

    it('handles successful bootstrap', async () => {
        render(
            <BrowserRouter>
                <Bootstrap />
            </BrowserRouter>
        );

        await screen.findByText('First Admin');

        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });

        (axios.post as any).mockResolvedValue({
            data: {
                ok: true,
                token: 'fake-token',
                user: { id: 1, username: 'admin' },
                refreshToken: 'fake-refresh-token'
            }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

        await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/auth/bootstrap', {
            username: 'admin',
            password: 'password123'
        }));

        expect(mockLogin).toHaveBeenCalledWith('fake-token', expect.objectContaining({ username: 'admin' }), 'fake-refresh-token');
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('handles failed bootstrap', async () => {
        render(
            <BrowserRouter>
                <Bootstrap />
            </BrowserRouter>
        );

        await screen.findByText('First Admin');

        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'admin' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
        fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'password123' } });

        (axios.post as any).mockRejectedValue({
            response: {
                data: { message: 'Bootstrap failed error' }
            }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Create admin' }));

        const errorMessage = await screen.findByText('Bootstrap failed error');
        expect(errorMessage).toBeInTheDocument();
        expect(mockLogin).not.toHaveBeenCalled();
    });
});
