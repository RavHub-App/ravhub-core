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

export default function Bootstrap() {
    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [error, setError] = React.useState('');
    const [checking, setChecking] = React.useState(true);
    const { login } = useAuth();
    const navigate = useNavigate();

    React.useEffect(() => {
        // Check if bootstrap is still required
        const checkBootstrapStatus = async () => {
            try {
                const response = await axios.get('/api/auth/bootstrap-status');
                if (response.data.ok && !response.data.bootstrapRequired) {
                    // Users already exist, redirect to login
                    navigate('/auth/login');
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

        if (!password) {
            setError('Password is required');
            return;
        }

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            // Use absolute API base from Vite env (set to http://localhost:3000 in dev)
            const response = await axios.post('/api/auth/bootstrap', { username, password });
            if (response.data.ok) {
                login(response.data.token, response.data.user, response.data.refreshToken);
                navigate('/');
            }
        } catch (err: any) {
            setError(err.response?.data?.message || 'Bootstrap failed');
        }
    };

    if (checking) {
        return (
            <Sheet
                sx={{
                    width: 360,
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
                width: 360,
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
                <Typography level="h4" component="h1"><b>First Admin</b></Typography>
                <Typography level="body-sm">Create the first administrator account for this installation.</Typography>
            </div>
            <form onSubmit={handleSubmit}>
                <FormControl>
                    <FormLabel>Username</FormLabel>
                    <Input
                        name="username"
                        type="text"
                        placeholder="admin"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                    />
                </FormControl>

                <FormControl sx={{ mt: 1 }}>
                    <FormLabel>Password</FormLabel>
                    <Input
                        name="password"
                        type="password"
                        placeholder="Enter password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                </FormControl>

                <FormControl sx={{ mt: 1 }}>
                    <FormLabel>Confirm Password</FormLabel>
                    <Input
                        name="confirmPassword"
                        type="password"
                        placeholder="Confirm password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                    />
                </FormControl>

                {error && (
                    <Typography color="danger" level="body-sm" sx={{ mt: 1 }}>
                        {error}
                    </Typography>
                )}

                <Button sx={{ mt: 2, width: '100%' }} type="submit">Create admin</Button>
            </form>
        </Sheet>
    );
}
