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

