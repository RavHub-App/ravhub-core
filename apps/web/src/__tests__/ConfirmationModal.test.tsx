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
import { render, screen, fireEvent, waitFor } from '../test-utils';
import ConfirmationModal from '../components/ConfirmationModal';
import { vi } from 'vitest';

describe('ConfirmationModal', () => {
    it('renders correctly when open', () => {
        render(
            <ConfirmationModal
                open={true}
                onClose={() => { }}
                onConfirm={() => { }}
                title="Are you sure?"
                message="This action cannot be undone."
            />
        );

        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
        expect(screen.getByText('This action cannot be undone.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('does not render when closed', () => {
        render(
            <ConfirmationModal
                open={false}
                onClose={() => { }}
                onConfirm={() => { }}
                title="Are you sure?"
                message="This action cannot be undone."
            />
        );

        expect(screen.queryByText('Are you sure?')).not.toBeInTheDocument();
    });

    it('calls onClose when Cancel is clicked', () => {
        const handleClose = vi.fn();
        render(
            <ConfirmationModal
                open={true}
                onClose={handleClose}
                onConfirm={() => { }}
                title="Are you sure?"
                message="This action cannot be undone."
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(handleClose).toHaveBeenCalledTimes(1);
    });

    it('calls onConfirm when Confirm is clicked', () => {
        const handleConfirm = vi.fn();
        render(
            <ConfirmationModal
                open={true}
                onClose={() => { }}
                onConfirm={handleConfirm}
                title="Are you sure?"
                message="This action cannot be undone."
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
        expect(handleConfirm).toHaveBeenCalledTimes(1);
    });

    it('shows loading state on confirm button', () => {
        render(
            <ConfirmationModal
                open={true}
                onClose={() => { }}
                onConfirm={() => { }}
                title="Are you sure?"
                message="This action cannot be undone."
                loading={true}
            />
        );

        const confirmBtn = screen.getByRole('button', { name: 'Confirm' });
        // Joy UI loading button might be disabled or show a spinner. 
        // Joy UI loading button renders a progress indicator
        // We look for a progressbar within the button
        expect(confirmBtn.querySelector('span[role="progressbar"]')).toBeTruthy();
    });

    it('renders custom text', () => {
        render(
            <ConfirmationModal
                open={true}
                onClose={() => { }}
                onConfirm={() => { }}
                title="Delete Repo?"
                message="Deletes default."
                confirmText="Yes, delete it"
                cancelText="No, keep it"
            />
        );

        expect(screen.getByText('Yes, delete it')).toBeInTheDocument();
        expect(screen.getByText('No, keep it')).toBeInTheDocument();
    });
});
