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
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AuthGuard from '../components/AuthGuard';
import { useAuth } from '../contexts/AuthContext';
import { vi } from 'vitest';

// Mock the usage of useAuth
vi.mock('../contexts/AuthContext', () => ({
    useAuth: vi.fn(),
    AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

describe('AuthGuard', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('shows loading spinner when isLoading is true', () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: false, isLoading: true });

        render(
            <MemoryRouter>
                <AuthGuard>
                    <div>Protected Content</div>
                </AuthGuard>
            </MemoryRouter>
        );

        // CircularProgress from MUI Joy typically has role "progressbar" or we can check class
        // Joy UI CircularProgress has role="progressbar"
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('redirects to login when not authenticated', () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: false, isLoading: false });

        render(
            <MemoryRouter initialEntries={['/protected']}>
                <Routes>
                    <Route path="/auth/login" element={<div>Login Page</div>} />
                    <Route
                        path="/protected"
                        element={
                            <AuthGuard>
                                <div>Protected Content</div>
                            </AuthGuard>
                        }
                    />
                </Routes>
            </MemoryRouter>
        );

        expect(screen.getByText('Login Page')).toBeInTheDocument();
        expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    });

    it('renders children when authenticated', () => {
        (useAuth as any).mockReturnValue({ isAuthenticated: true, isLoading: false });

        render(
            <MemoryRouter>
                <AuthGuard>
                    <div>Protected Content</div>
                </AuthGuard>
            </MemoryRouter>
        );

        expect(screen.getByText('Protected Content')).toBeInTheDocument();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
});
