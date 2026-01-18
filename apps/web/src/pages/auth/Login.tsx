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

import Sheet from '@mui/joy/Sheet';
import Typography from '@mui/joy/Typography';
import FormControl from '@mui/joy/FormControl';
import FormLabel from '@mui/joy/FormLabel';
import Input from '@mui/joy/Input';
import Button from '@mui/joy/Button';
import Box from '@mui/joy/Box';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import logo from '../../assets/logo.svg';

export default function Login() {
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [error, setError] = React.useState('');
    const [checking, setChecking] = React.useState(true);
    const { login } = useAuth();
    const navigate = useNavigate();

    React.useEffect(() => {
        // Check if bootstrap is required on component mount
        const checkBootstrapStatus = async () => {
            try {
                const response = await axios.get('/api/auth/bootstrap-status');
                if (response.data.ok && response.data.bootstrapRequired) {
                    // Redirect to bootstrap page
                    navigate('/auth/bootstrap');
                }
            } catch (err) {
                console.error('Failed to check bootstrap status:', err);
            } finally {
                setChecking(false);
            }
        };

        checkBootstrapStatus();
    }, [navigate]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setError('');
        try {
            const response = await axios.post('/api/auth/login', { username, password });
            if (response.data.ok) {
                login(response.data.token, response.data.user, response.data.refreshToken);
                navigate('/');
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Login failed');
        }
    };

    if (checking) {
        return (
            <Sheet
                sx={{
                    width: 300,
                    mx: 'auto',
                    my: 4,
                    py: 3,
                    px: 2,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    borderRadius: 'sm',
                    boxShadow: 'md',
                    alignItems: 'center',
                }}
                variant="outlined"
            >
                <Typography level="body-sm">Checking system status...</Typography>
            </Sheet>
        );
    }

    return (
        <Sheet
            sx={{
                width: 300,
                mx: 'auto',
                my: 4,
                py: 3,
                px: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                borderRadius: 'sm',
                boxShadow: 'md',
            }}
            variant="outlined"
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, mb: 1 }}>
                <Box
                    component="img"
                    src={logo}
                    alt="RavHub"
                    sx={{ width: 40, height: 40 }}
                />
                <Typography level="h3" sx={{ fontWeight: 'bold' }}>
                    RavHub
                </Typography>
            </Box>
            <div>
                <Typography level="h4" component="h1">
                    <b>Welcome!</b>
                </Typography>
                <Typography level="body-sm">Sign in to continue.</Typography>
            </div>
            <form onSubmit={handleSubmit}>
                <FormControl>
                    <FormLabel>Username</FormLabel>
                    <Input
                        name="username"
                        type="text"
                        placeholder="johndoe"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </FormControl>
                <FormControl sx={{ mt: 1 }}>
                    <FormLabel>Password</FormLabel>
                    <Input
                        name="password"
                        type="password"
                        placeholder="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </FormControl>
                {error && (
                    <Typography color="danger" level="body-sm" sx={{ mt: 1 }}>
                        {error}
                    </Typography>
                )}
                <Button sx={{ mt: 2, width: '100%' }} type="submit">Log in</Button>
            </form>
        </Sheet>
    );
}
