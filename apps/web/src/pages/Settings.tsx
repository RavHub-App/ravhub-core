import { useState } from 'react'
import { Typography, Box, Tabs, TabList, Tab, TabPanel } from '@mui/joy'
import StorageSettings from '../components/Settings/StorageSettings'
import BackupSettings from '../components/Settings/BackupSettings'
import CleanupSettings from '../components/Settings/CleanupSettings'
import AuditLogs from '../components/Settings/AuditLogs'
import LicenseSettings from '../components/Settings/LicenseSettings'

export default function Settings() {
    const [tab, setTab] = useState(0)

    return (
        <Box>
            <Typography level="h2" >Settings</Typography>
            <Typography level="body-md" color="neutral" sx={{ mb: 3 }}>Manage your instance settings and preferences</Typography>

            <Tabs value={tab} onChange={(_, val) => setTab(val as number)} sx={{ bgcolor: 'transparent' }}>
                <TabList>
                    <Tab>Storage</Tab>
                    <Tab>Cleanup</Tab>
                    <Tab>Audit Logs</Tab>
                    <Tab>Backups</Tab>
                    <Tab>License</Tab>
                </TabList>

                <TabPanel value={0} sx={{ p: 0, pt: 2 }}>
                    <StorageSettings />
                </TabPanel>

                <TabPanel value={1} sx={{ p: 0, pt: 2 }}>
                    <CleanupSettings />
                </TabPanel>

                <TabPanel value={2} sx={{ p: 0, pt: 2 }}>
                    <AuditLogs />
                </TabPanel>

                <TabPanel value={3} sx={{ p: 0, pt: 2 }}>
                    <BackupSettings />
                </TabPanel>

                <TabPanel value={4} sx={{ p: 0, pt: 2 }}>
                    <LicenseSettings />
                </TabPanel>
            </Tabs>
        </Box>
    )
}

