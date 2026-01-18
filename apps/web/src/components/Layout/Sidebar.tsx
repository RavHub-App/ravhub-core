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


import { Box, List, ListItem, ListItemButton, ListItemContent, ListItemDecorator, Typography, Sheet, Divider } from '@mui/joy';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext'
import logo from '../../assets/logo.svg';
import DashboardIcon from '@mui/icons-material/Dashboard';
import PeopleIcon from '@mui/icons-material/People';
import SecurityIcon from '@mui/icons-material/Security';
import SettingsIcon from '@mui/icons-material/Settings';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';

export default function Sidebar() {
    const location = useLocation();
    const { user } = useAuth();

    const isActive = (path: string) => location.pathname === path;

    return (
        <Sheet
            className="Sidebar"
            sx={{
                position: 'fixed',
                transform: {
                    xs: 'translateX(calc(100% * (var(--SideNavigation-slideIn, 0) - 1)))',
                    md: 'none',
                },
                transition: 'transform 0.4s, width 0.4s',
                zIndex: 10000,
                height: '100dvh',
                width: 'var(--Sidebar-width)',
                top: 0,
                p: 2,
                flexShrink: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                borderRight: '1px solid',
                borderColor: 'divider',
            }}
        >
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Box
                    component="img"
                    src={logo}
                    alt="RavHub"
                    sx={{
                        width: 24,
                        height: 24,
                        objectFit: 'contain'
                    }}
                />
                <Typography level="title-lg">RavHub</Typography>
            </Box>

            <Box sx={{ minHeight: 0, overflow: 'hidden auto', flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <List
                    size="sm"
                    sx={{
                        gap: 1,
                        '--List-nestedInsetStart': '30px',
                        '--ListItem-radius': (theme) => theme.vars.radius.sm,
                    }}
                >
                    <ListItem>
                        <ListItemButton component={Link} to="/" selected={isActive('/')}>
                            <ListItemDecorator>
                                <DashboardIcon />
                            </ListItemDecorator>
                            <ListItemContent>Dashboard</ListItemContent>
                        </ListItemButton>
                    </ListItem>

                    <ListItem nested>
                        <ListItem>
                            <Typography level="body-xs" fontWeight="lg" sx={{ px: 1, mt: 1, mb: 0.5 }}>
                                BROWSE
                            </Typography>
                        </ListItem>
                        <ListItem>
                            <ListItemButton component={Link} to="/repos" selected={isActive('/repos')}>
                                <ListItemDecorator>
                                    <FolderOpenIcon />
                                </ListItemDecorator>
                                <ListItemContent>Repositories</ListItemContent>
                            </ListItemButton>
                        </ListItem>
                    </ListItem>

                    <ListItem nested>
                        <ListItem>
                            <Typography level="body-xs" fontWeight="lg" sx={{ px: 1, mt: 1, mb: 0.5 }}>
                                ADMINISTRATION
                            </Typography>
                        </ListItem>

                        {(() => {
                            const canManage = Boolean(
                                user && (
                                    user.permissions?.includes('repo.manage') ||
                                    user.permissions?.includes('*') ||
                                    user.roles?.includes('admin') ||
                                    user.roles?.includes('superadmin')
                                )
                            );
                            if (!canManage) return null;
                            return (
                                <ListItem>
                                    <ListItemButton component={Link} to="/admin/repos" selected={isActive('/admin/repos')}>
                                        <ListItemDecorator>
                                            <FolderOpenIcon />
                                        </ListItemDecorator>
                                        <ListItemContent>Repository Management</ListItemContent>
                                    </ListItemButton>
                                </ListItem>
                            )
                        })()}
                        <ListItem>
                            <ListItemButton component={Link} to="/users" selected={isActive('/users')}>
                                <ListItemDecorator>
                                    <PeopleIcon />
                                </ListItemDecorator>
                                <ListItemContent>Users</ListItemContent>
                            </ListItemButton>
                        </ListItem>
                        <ListItem>
                            <ListItemButton component={Link} to="/roles" selected={isActive('/roles')}>
                                <ListItemDecorator>
                                    <SecurityIcon />
                                </ListItemDecorator>
                                <ListItemContent>Roles</ListItemContent>
                            </ListItemButton>
                        </ListItem>
                        <ListItem>
                            <ListItemButton component={Link} to="/settings" selected={isActive('/settings')}>
                                <ListItemDecorator>
                                    <SettingsIcon />
                                </ListItemDecorator>
                                <ListItemContent>Settings</ListItemContent>
                            </ListItemButton>
                        </ListItem>
                    </ListItem>
                </List>
            </Box>

            <Divider />

            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <Typography level="body-xs">v1.0.0</Typography>
            </Box>
        </Sheet>
    );
}
