import { Box, Typography, IconButton, Dropdown, Menu, MenuButton, MenuItem, Avatar, Chip } from '@mui/joy';
import MenuIcon from '@mui/icons-material/Menu';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import { useAuth } from '../../contexts/AuthContext';
import { useEffect, useState } from 'react';
import axios from 'axios';
import GlobalSearch from './GlobalSearch';

interface HeaderProps {
    onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
    const { logout, user } = useAuth();
    const [healthStatus, setHealthStatus] = useState<'healthy' | 'degraded' | 'down'>('healthy');

    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await axios.get('/api/health');
                if (res.data.ok && res.data.db) {
                    setHealthStatus('healthy');
                } else {
                    setHealthStatus('degraded');
                }
            } catch {
                setHealthStatus('down');
            }
        };

        checkHealth();
        const interval = setInterval(checkHealth, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, []);

    const healthColor = healthStatus === 'healthy' ? 'success' : healthStatus === 'degraded' ? 'warning' : 'danger';

    return (
        <Box
            component="header"
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: '1px solid',
                borderColor: 'divider',
                bgcolor: 'background.surface',
                px: 2,
                py: 1,
                zIndex: 1000,
                position: 'sticky',
                top: 0,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <IconButton
                    variant="outlined"
                    color="neutral"
                    onClick={onMenuClick}
                    sx={{ display: { sm: 'none' } }}
                >
                    <MenuIcon />
                </IconButton>
                <GlobalSearch />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Chip
                    size="sm"
                    variant="soft"
                    color={healthColor}
                    sx={{ textTransform: 'capitalize' }}
                >
                    {healthStatus}
                </Chip>

                <Dropdown>
                    <MenuButton
                        slots={{ root: IconButton }}
                        slotProps={{ root: { variant: 'plain', color: 'neutral' } }}
                    >
                        <Avatar size="sm">
                            <AccountCircleIcon />
                        </Avatar>
                    </MenuButton>
                    <Menu placement="bottom-end">
                        <MenuItem disabled>
                            <Typography level="body-sm">{user?.username || 'User'}</Typography>
                        </MenuItem>
                        <MenuItem onClick={logout}>
                            <LogoutRoundedIcon />
                            Log out
                        </MenuItem>
                    </Menu>
                </Dropdown>
            </Box>
        </Box>
    );
}
