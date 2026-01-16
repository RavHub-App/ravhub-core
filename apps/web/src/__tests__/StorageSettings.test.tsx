import { renderWithProviders, screen, fireEvent, waitFor } from '../test-utils';
import StorageSettings from '../components/Settings/StorageSettings';
import axios from 'axios';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('axios');

describe('StorageSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        // Mock /api/auth/me to return no user by default
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/auth/me') {
                return Promise.resolve({ data: { ok: false } });
            }
            if (url === '/api/storage/configs') {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: [] });
        });
    });

    it('renders and fetches configs', async () => {
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/auth/me') {
                return Promise.resolve({ data: { ok: false } });
            }
            if (url === '/api/storage/configs') {
                return Promise.resolve({
                    data: [{ id: 'local-1', key: 'local-1', type: 'filesystem', config: {} }]
                });
            }
            return Promise.resolve({ data: [] });
        });

        renderWithProviders(<StorageSettings />);

        await waitFor(() => {
            expect(screen.getByText('local-1')).toBeInTheDocument();
        });
    });

    it('opens dialog on add click', async () => {
        // Mock /api/auth/me to return admin user
        localStorage.setItem('token', 'fake-token');
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/auth/me') {
                return Promise.resolve({
                    data: {
                        ok: true,
                        user: { id: 'u1', username: 'admin', roles: ['admin'], permissions: ['system.admin'] }
                    }
                });
            }
            if (url === '/api/storage/configs') {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: [] });
        });

        renderWithProviders(<StorageSettings />);

        // Wait for auth to load and add button to appear
        const addButton = await screen.findByRole('button', { name: /Add Config/i }, { timeout: 3000 });
        fireEvent.click(addButton);
        await waitFor(() => expect(screen.getByText('Add Storage')).toBeInTheDocument());
    });

    it('hides add button for non-admin users', async () => {
        // Mock /api/auth/me to return no user
        (axios.get as any).mockImplementation((url: string) => {
            if (url === '/api/auth/me') {
                return Promise.resolve({ data: { ok: false } });
            }
            if (url === '/api/storage/configs') {
                return Promise.resolve({ data: [] });
            }
            return Promise.resolve({ data: [] });
        });

        renderWithProviders(<StorageSettings />);

        await waitFor(() => {
            expect(screen.queryByRole('button', { name: /Add Config/i })).toBeNull();
        }, { timeout: 3000 });
    });
});
