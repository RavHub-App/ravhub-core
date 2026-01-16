import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { NotificationProvider } from './components/NotificationSystem';

export function renderWithProviders(ui: React.ReactElement, options = {}) {
    return render(
        <AuthProvider>
            <NotificationProvider>
                <BrowserRouter>{ui}</BrowserRouter>
            </NotificationProvider>
        </AuthProvider>,
        options
    );
}

export * from '@testing-library/react';
