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
import LicenseSettings from '../components/Settings/LicenseSettings';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

describe('LicenseSettings', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('renders no license state correctly', async () => {
        (axios.get as any).mockResolvedValue({
            data: { hasLicense: false, isActive: false }
        });

        renderWithProviders(<LicenseSettings />);

        await screen.findByText('Upgrade to Enterprise');
        expect(screen.getByText('Get Enterprise License')).toBeInTheDocument();
        expect(screen.getByText('Manual Activation')).toBeInTheDocument();
    });

    it('renders active license state correctly', async () => {
        (axios.get as any).mockResolvedValue({
            data: {
                hasLicense: true,
                isActive: true,
                key: 'test-key',
                type: 'enterprise',
                validationStatus: { valid: true },
                expiresAt: new Date(Date.now() + 86400000).toISOString() // tomorrow
            }
        });

        renderWithProviders(<LicenseSettings />);

        await screen.findByText('License Status');

        // Status chips
        expect(screen.getByText('Active')).toBeInTheDocument();
        expect(screen.getByText('ENTERPRISE')).toBeInTheDocument();

        // Buttons
        expect(screen.getByText('Revalidate')).toBeInTheDocument();
        expect(screen.getByText('Remove')).toBeInTheDocument();
    });

    it('handles manual activation', async () => {
        (axios.get as any).mockResolvedValue({
            data: { hasLicense: false, isActive: false }
        });
        (axios.post as any).mockResolvedValue({ data: { success: true } });

        renderWithProviders(<LicenseSettings />);

        await screen.findByText('Manual Activation');

        const input = screen.getByPlaceholderText('DC-XXXX-XXXX-XXXX-XXXX');
        fireEvent.change(input, { target: { value: 'NEW-KEY-123' } });

        const activateBtn = screen.getByRole('button', { name: 'Activate License' });
        fireEvent.click(activateBtn);

        await waitFor(() => expect(axios.post).toHaveBeenCalledWith('/api/licenses/activate', {
            key: 'NEW-KEY-123'
        }));
    });

    it('handles license validation error', async () => {
        (axios.get as any).mockResolvedValue({
            data: {
                hasLicense: true,
                isActive: false,
                validationStatus: {
                    valid: false,
                    reason: 'Expired'
                }
            }
        });

        renderWithProviders(<LicenseSettings />);

        await screen.findByText('Invalid License');
        expect(screen.getByText('Expired')).toBeInTheDocument();
    });
});
