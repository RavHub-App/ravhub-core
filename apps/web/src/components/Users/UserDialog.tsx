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

import * as React from 'react';
import { Modal, ModalDialog, DialogTitle, DialogContent, Stack, FormControl, FormLabel, Input, Button, ModalClose, Checkbox, Box, Typography } from '@mui/joy';
import axios from 'axios';

interface UserDialogProps {
    open: boolean;
    onClose: () => void;
    onSaved: () => void;
    user?: any; // If provided, we are editing
}

export default function UserDialog({ open, onClose, onSaved, user }: UserDialogProps) {
    const [username, setUsername] = React.useState('');
    const [displayName, setDisplayName] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [roles, setRoles] = React.useState<string[]>([]);
    const [loading, setLoading] = React.useState(false);
    const [availableRoles, setAvailableRoles] = React.useState<any[]>([]);

    React.useEffect(() => {
        if (open) {
            // Fetch available roles
            axios.get('/api/rbac/roles').then(res => setAvailableRoles(res.data)).catch(() => { });

            if (user) {
                setUsername(user.username);
                setDisplayName(user.displayName || '');
                setRoles(user.roles?.map((r: any) => r.name) || []);
            } else {
                setUsername('');
                setDisplayName('');
                setPassword('');
                setRoles([]);
            }
        }
    }, [open, user]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            if (user) {
                // Edit mode
                const payload: any = { displayName };
                if (password) payload.password = password;
                payload.roles = roles;
                await axios.put(`/api/users/${user.id}`, payload);
            } else {
                // Create mode
                await axios.post('/api/users', { username, displayName, password, roles });
            }
            onSaved();
            onClose();
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    const handleRoleChange = (role: string, checked: boolean) => {
        if (checked) {
            setRoles([...roles, role]);
        } else {
            setRoles(roles.filter(r => r !== role));
        }
    };

    return (
        <Modal open={open} onClose={onClose}>
            <ModalDialog sx={{ minWidth: 400 }}>
                <ModalClose />
                <DialogTitle>{user ? 'Edit User' : 'Create User'}</DialogTitle>
                <DialogContent>Manage user details and roles.</DialogContent>
                <form onSubmit={handleSubmit}>
                    <Stack spacing={2}>
                        <FormControl required>
                            <FormLabel>Username</FormLabel>
                            <Input
                                autoFocus
                                required
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                disabled={!!user} // Username usually immutable
                            />
                        </FormControl>
                        <FormControl>
                            <FormLabel>Display Name</FormLabel>
                            <Input
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                            />
                        </FormControl>
                        {!user && (
                            <FormControl required>
                                <FormLabel>Password</FormLabel>
                                <Input
                                    type="password"
                                    required
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                />
                            </FormControl>
                        )}

                        <FormControl>
                            <FormLabel>Roles</FormLabel>
                            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                                {availableRoles.length > 0 ? availableRoles.map(r => (
                                    <Checkbox
                                        key={r.id}
                                        label={r.name}
                                        checked={roles.includes(r.name)}
                                        onChange={(e) => handleRoleChange(r.name, e.target.checked)}
                                    />
                                )) : (
                                    <Typography level="body-xs">No roles found</Typography>
                                )}
                            </Box>
                        </FormControl>

                        <Button type="submit" loading={loading}>{user ? 'Save Changes' : 'Create User'}</Button>
                    </Stack>
                </form>
            </ModalDialog>
        </Modal>
    );
}
