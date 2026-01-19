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
import { render, screen, act } from '@testing-library/react';
import { NotificationProvider, useNotification } from '../components/NotificationSystem';
import { vi } from 'vitest';

// Component to trigger notification
const TestComponent = ({ message }: { message: string }) => {
    const { notify } = useNotification();
    return <button onClick={() => notify(message)}>Notify</button>;
};

describe('NotificationSystem', () => {
    it('throws error when used outside provider', () => {
        // Suppress console.error for this test as React logs the error
        const consoleSpy = vi.spyOn(console, 'error');
        consoleSpy.mockImplementation(() => { });

        expect(() => render(<TestComponent message="test" />)).toThrow('useNotification must be used within NotificationProvider');

        consoleSpy.mockRestore();
    });

    it('renders and shows notification', async () => {
        render(
            <NotificationProvider>
                <TestComponent message="Hello World" />
            </NotificationProvider>
        );

        const btn = screen.getByText('Notify');
        act(() => {
            btn.click();
        });

        // Find snackbar content
        const notification = await screen.findByText('Hello World');
        expect(notification).toBeInTheDocument();
    });
});
