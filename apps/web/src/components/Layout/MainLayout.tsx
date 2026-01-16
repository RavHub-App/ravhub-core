import * as React from 'react';
import { Box } from '@mui/joy';
import Sidebar from './Sidebar';
import Header from './Header';

export default function MainLayout({ children }: { children: React.ReactNode }) {
    const [sidebarOpen, setSidebarOpen] = React.useState(false);

    return (
        <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
            <Sidebar />
            <Box
                component="main"
                className="MainContent"
                sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    minWidth: 0,
                    height: '100dvh',
                    gap: 1,
                    overflow: 'auto',
                    ml: { md: 'calc(var(--Sidebar-width) + 33px)' },
                }}
            >
                <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />
                <Box sx={{ p: 2, pt: 0 }}>
                    {children}
                </Box>
            </Box>
        </Box>
    );
}
