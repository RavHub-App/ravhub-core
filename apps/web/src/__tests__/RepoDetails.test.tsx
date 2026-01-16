import React from 'react';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import RepoDetails from '../pages/RepoDetails';
import axios from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../contexts/AuthContext';
import { NotificationProvider } from '../components/NotificationSystem';
import { vi } from 'vitest';

vi.mock('axios');

describe('RepoDetails settings', () => {
    beforeEach(() => vi.resetAllMocks());

    it('allows admin to edit docker port and saves to API', async () => {
        const repo = { id: 'r1', name: 'r1', manager: 'docker', type: 'hosted', config: { docker: { port: 5010 } } };

        // Mock the docker plugin schema response
        const dockerPluginSchema = {
            type: 'object',
            properties: {
                docker: {
                    type: 'object',
                    title: 'Docker registry settings',
                    properties: {
                        version: {
                            type: 'string',
                            title: 'Registry protocol version',
                            enum: ['v1', 'v2'],
                            default: 'v2',
                        },
                        port: {
                            type: 'number',
                            title: 'Registry port',
                            description: 'Optional port to expose this repository registry on',
                        },
                    },
                },
            },
        };

        // axios.get used in effect — return repo first, then plugin schema
        (axios.get as any).mockImplementation((url: string) => {
            if (url.includes('/api/plugins/docker/ping')) {
                return Promise.resolve({
                    data: {
                        ok: true,
                        capabilities: {
                            repoTypes: ['hosted', 'proxy', 'group'],
                            configSchema: dockerPluginSchema,
                        },
                    },
                });
            }
            if (url.includes('/api/repository/r1')) {
                return Promise.resolve({ data: repo });
            }
            return Promise.reject(new Error('Unknown URL'));
        });

        (axios.put as any).mockResolvedValue({ data: { ...repo, config: { docker: { port: 5020 } } } });

        // simulate authenticated admin user so Settings are visible
        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', roles: ['admin'], permissions: ['repo.manage', 'repo.write'] }));

        render(
            <AuthProvider>
                <NotificationProvider>
                    <MemoryRouter initialEntries={[{ pathname: '/admin/repos/r1', state: { repo, tab: 2 } }]}>
                        <RepoDetails />
                    </MemoryRouter>
                </NotificationProvider>
            </AuthProvider>
        );

        // Wait for the port input to appear (rendered from schema)
        const portInput = await screen.findByLabelText(/Registry port/i);
        expect(portInput).toBeInTheDocument();

        // Change port value
        fireEvent.change(portInput, { target: { value: '5020' } });

        const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
        fireEvent.click(saveBtn);

        await waitFor(() => expect(axios.put).toHaveBeenCalled());
        const calledUrl = (axios.put as any).mock.calls[0][0];
        expect(calledUrl).toContain('/api/repository/');
        const body = (axios.put as any).mock.calls[0][1];
        expect(body.config?.docker?.port).toBe(5020);
    });

    // Access URL input removed from the settings form as this value is server-managed for hosted repos

    it('does not show Upload tab for docker repos even when user has upload permission', async () => {
        const repo = { id: 'rd1', name: 'rd1', manager: 'docker', type: 'hosted', config: { docker: { port: 5010 } } };
        (axios.get as any).mockResolvedValue({ data: repo });

        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', roles: ['admin'], permissions: ['repo.write'] }));

        render(
            <AuthProvider>
                <NotificationProvider>
                    <MemoryRouter initialEntries={[{ pathname: '/admin/repos/rd1', state: { repo } }]}>
                        <RepoDetails />
                    </MemoryRouter>
                </NotificationProvider>
            </AuthProvider>
        );

        // upload tab should not be present for docker
        expect(() => screen.getByText('Upload')).toThrow();
    });

    it('does not show Upload tab for non-hosted repos even when user has upload permission', async () => {
        const repo = { id: 'rp1', name: 'rp1', manager: 'npm', type: 'proxy', config: {} };
        (axios.get as any).mockResolvedValue({ data: repo });

        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', roles: ['admin'], permissions: ['repo.write'] }));

        render(
            <AuthProvider>
                <NotificationProvider>
                    <MemoryRouter initialEntries={[{ pathname: '/admin/repos/rp1', state: { repo } }]}>
                        <RepoDetails />
                    </MemoryRouter>
                </NotificationProvider>
            </AuthProvider>
        );

        // Upload tab should not be present for non-hosted (proxy) even if user has write permission
        expect(() => screen.getByText('Upload')).toThrow();
    });

    it('shows Upload tab for hosted non-docker repos when user has write permission', async () => {
        const repo = { id: 'rn1', name: 'rn1', manager: 'npm', type: 'hosted', config: {} };
        (axios.get as any).mockResolvedValue({ data: repo });

        localStorage.setItem('token', 't');
        localStorage.setItem('user', JSON.stringify({ id: 'u1', username: 'admin', roles: ['admin'], permissions: ['repo.write'] }));

        render(
            <AuthProvider>
                <NotificationProvider>
                    <MemoryRouter initialEntries={[{ pathname: '/admin/repos/rn1', state: { repo } }]}>
                        <RepoDetails />
                    </MemoryRouter>
                </NotificationProvider>
            </AuthProvider>
        );

        // Upload tab should be visible for hosted non-docker
        const uploadTab = await screen.findByText('Upload');
        expect(uploadTab).toBeInTheDocument();
    });
});
