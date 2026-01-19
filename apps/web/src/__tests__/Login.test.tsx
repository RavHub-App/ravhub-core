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
import Login from '../pages/auth/Login';
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

describe('Login Page', () => {
    const mockLogin = vi.fn();

    beforeEach(() => {
        vi.resetAllMocks();
        (useAuth as any).mockReturnValue({ login: mockLogin });
        // Default: bootstrap check returns not required
        (axios.get as any).mockResolvedValue({ data: { ok: true, bootstrapRequired: false } });
    });

    it('redirects to bootstrap if required', async () => {
        (axios.get as any).mockResolvedValue({ data: { ok: true, bootstrapRequired: true } });

        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/auth/bootstrap'));
    });

    it('renders login form when bootstrap not required', async () => {
        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        // Wait for loading to finish
        await screen.findByText('Sign in to continue.');

        expect(screen.getByLabelText('Username')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Log in' })).toBeInTheDocument();
    });

    it('handles successful login', async () => {
        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        await screen.findByText('Sign in to continue.');

        const usernameInput = screen.getByLabelText('Username');
        const passwordInput = screen.getByLabelText('Password');

        fireEvent.change(usernameInput, { target: { value: 'testuser' } });
        fireEvent.change(passwordInput, { target: { value: 'password123' } });

        (axios.post as any).mockResolvedValue({
            data: {
                ok: true,
                token: 'fake-token',
                user: { id: 1, username: 'testuser' },
                refreshToken: 'fake-refresh-token'
            }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

        await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/auth/login', {
            username: 'testuser',
            password: 'password123'
        }));

        expect(mockLogin).toHaveBeenCalledWith('fake-token', expect.objectContaining({ username: 'testuser' }), 'fake-refresh-token');
        expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('handles failed login', async () => {
        render(
            <BrowserRouter>
                <Login />
            </BrowserRouter>
        );

        await screen.findByText('Sign in to continue.');

        const usernameInput = screen.getByLabelText('Username');
        const passwordInput = screen.getByLabelText('Password');

        fireEvent.change(usernameInput, { target: { value: 'wrong' } });
        fireEvent.change(passwordInput, { target: { value: 'wrong' } });

        (axios.post as any).mockRejectedValue({
            response: {
                data: { message: 'Invalid credentials' }
            }
        });

        fireEvent.click(screen.getByRole('button', { name: 'Log in' }));

        const errorMessage = await screen.findByText('Invalid credentials');
        expect(errorMessage).toBeInTheDocument();
        expect(mockLogin).not.toHaveBeenCalled();
    });
});
