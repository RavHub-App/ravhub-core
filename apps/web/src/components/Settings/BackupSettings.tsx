import { useState, useEffect } from 'react'
import {
    Box,
    Button,
    Card,
    CardContent,
    Typography,
    Table,
    Chip,
    IconButton,
    Modal,
    ModalDialog,
    ModalClose,
    FormControl,
    FormLabel,
    Input,
    Select,
    Option,
    Textarea,
    LinearProgress,
    Stack,
    Divider,
    Tabs,
    TabList,
    Tab,
    TabPanel,
    Alert,
} from '@mui/joy'
import axios from 'axios'
import DeleteIcon from '@mui/icons-material/Delete'
import RestoreIcon from '@mui/icons-material/Restore'
import AddIcon from '@mui/icons-material/Add'
import ScheduleIcon from '@mui/icons-material/Schedule'
import WarningIcon from '@mui/icons-material/Warning'
import { useNotification } from '../NotificationSystem'
import ConfirmationModal from '../ConfirmationModal'

export default function BackupSettings() {
    const [backups, setBackups] = useState<any[]>([])
    const [schedules, setSchedules] = useState<any[]>([])
    const [storageConfigs, setStorageConfigs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [createOpen, setCreateOpen] = useState(false)
    const [scheduleOpen, setScheduleOpen] = useState(false)
    const [tabValue, setTabValue] = useState(0)
    const [hasLicense, setHasLicense] = useState<boolean>(false)
    const { notify } = useNotification()
    const [confirmAction, setConfirmAction] = useState<{
        open: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        color: 'primary' | 'danger' | 'warning';
    }>({
        open: false,
        title: '',
        message: '',
        onConfirm: () => { },
        color: 'primary',
    });

    // Create backup form
    const [backupName, setBackupName] = useState('')
    const [backupDesc, setBackupDesc] = useState('')
    const [backupType, setBackupType] = useState<'full' | 'incremental' | 'differential'>('full')
    const [storageConfigId, setStorageConfigId] = useState('')

    // Schedule form
    const [scheduleName, setScheduleName] = useState('')
    const [scheduleDesc, setScheduleDesc] = useState('')
    const [scheduleFrequency, setScheduleFrequency] = useState<'hourly' | 'daily' | 'weekly' | 'monthly'>('daily')
    const [scheduleBackupType, setScheduleBackupType] = useState<'full' | 'incremental' | 'differential'>('full')
    const [scheduleStorageId, setScheduleStorageId] = useState('')

    // Check license and load data helpers
    async function checkLicense() {
        try {
            const response = await axios.get('/api/licenses')
            const active = response.data.isActive === true
            setHasLicense(active)
            return active
        } catch (err) {
            setHasLicense(false)
            return false
        }
    }

    async function loadData() {
        try {
            const [backupsRes, schedulesRes, storageRes] = await Promise.all([
                axios.get('/api/backups'),
                axios.get('/api/backups/schedules/list'),
                axios.get('/api/storage/configs'),
            ])
            setBackups(backupsRes.data)
            setSchedules(schedulesRes.data)
            setStorageConfigs(storageRes.data)
        } catch (err) {
            console.error('Failed to load backup data:', err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        // Check license in background and always attempt to load data. We
        // purposefully load backups/schedules even if the license check fails
        // (the backend will block unauthorized requests appropriately). This
        // avoids hiding the whole UI when /api/licenses might require admin
        // scope and would incorrectly signal no license to regular users.
        let interval: ReturnType<typeof setInterval>

        checkLicense()
        loadData()
        interval = setInterval(loadData, 5000) // Refresh every 5s for progress updates

        return () => clearInterval(interval)
    }, [])



    const handleCreateBackup = async () => {
        if (!backupName.trim() || !storageConfigId) {
            notify('Please fill all required fields')
            return
        }

        try {
            await axios.post('/api/backups', {
                name: backupName,
                description: backupDesc,
                type: backupType,
                storageConfigId,
            })
            notify('Backup created successfully')
            setCreateOpen(false)
            setBackupName('')
            setBackupDesc('')
            setBackupType('full')
            setStorageConfigId('')
            loadData()
        } catch (err: any) {
            notify(err.response?.data?.message || 'Failed to create backup')
        }
    }

    const handleCreateSchedule = async () => {
        if (!scheduleName.trim() || !scheduleStorageId) {
            notify('Please fill all required fields')
            return
        }

        try {
            await axios.post('/api/backups/schedules', {
                name: scheduleName,
                description: scheduleDesc,
                frequency: scheduleFrequency,
                backupType: scheduleBackupType,
                storageConfigId: scheduleStorageId,
            })
            notify('Schedule created successfully')
            setScheduleOpen(false)
            setScheduleName('')
            setScheduleDesc('')
            setScheduleFrequency('daily')
            setScheduleBackupType('full')
            setScheduleStorageId('')
            loadData()
        } catch (err: any) {
            notify(err.response?.data?.message || 'Failed to create backup')
        } finally {
            setLoading(false)
        }
    }



    const handleDeleteBackup = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Delete Backup',
            message: 'Are you sure you want to delete this backup?',
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/backups/${id}`)
                    notify('Backup deleted successfully')
                    loadData()
                } catch (err: any) {
                    notify(err.response?.data?.message || 'Failed to delete backup')
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    const handleRestoreBackup = async (id: string) => {
        const backup = backups.find(b => b.id === id)
        const backupName = backup?.name || 'Unknown'
        const backupDate = backup?.createdAt ? new Date(backup.createdAt).toLocaleString() : 'Unknown date'

        const confirmMsg = `⚠️ WARNING: This will OVERWRITE ALL CURRENT DATA!\n\nRestore from: ${backupName}\nCreated: ${backupDate}\n\nThis operation cannot be undone. Are you absolutely sure?`

        setConfirmAction({
            open: true,
            title: 'Restore Backup',
            message: confirmMsg,
            color: 'danger',
            onConfirm: async () => {
                // Second confirmation for safety
                setConfirmAction({
                    open: true,
                    title: 'Final Warning',
                    message: 'This is your final warning. Proceed with restore? All current data will be replaced.',
                    color: 'danger',
                    onConfirm: async () => {
                        try {
                            notify('Starting restore... This may take several minutes')
                            const response = await axios.post(`/api/backups/${id}/restore`)
                            notify(response.data?.message || 'Restore completed successfully')

                            // Suggest page reload
                            setConfirmAction({
                                open: true,
                                title: 'Restore Completed',
                                message: 'Restore completed! Reload the page to see changes?',
                                color: 'primary',
                                onConfirm: () => {
                                    window.location.reload();
                                }
                            });
                        } catch (err: any) {
                            notify(err.response?.data?.message || 'Failed to restore backup')
                            setConfirmAction(prev => ({ ...prev, open: false }));
                        }
                    }
                });
            }
        });
    }

    const handleDeleteSchedule = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Delete Schedule',
            message: 'Are you sure you want to delete this schedule?',
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/backups/schedules/${id}`)
                    notify('Schedule deleted successfully')
                    loadData()
                } catch (err: any) {
                    notify(err.response?.data?.message || 'Failed to delete schedule')
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'completed': return 'success'
            case 'running': return 'primary'
            case 'failed': return 'danger'
            case 'cancelled': return 'neutral'
            default: return 'warning'
        }
    }

    const formatSize = (bytes?: number) => {
        if (!bytes) return 'N/A'
        const mb = bytes / (1024 * 1024)
        if (mb < 1024) return `${mb.toFixed(2)} MB`
        return `${(mb / 1024).toFixed(2)} GB`
    }

    const formatDate = (date?: string) => {
        if (!date) return 'N/A'
        return new Date(date).toLocaleString()
    }

    if (loading) {
        return <Typography>Loading backups...</Typography>
    }

    return (
        <Card variant="outlined">
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <ScheduleIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                        <Box>
                            <Typography level="title-md">Backup Management</Typography>
                            <Typography level="body-sm">Create, schedule, and restore backups.</Typography>
                        </Box>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Button
                            startDecorator={<AddIcon />}
                            onClick={() => setCreateOpen(true)}
                            size="sm"
                            disabled={!hasLicense}
                        >
                            Create Backup
                        </Button>
                        <Button
                            startDecorator={<ScheduleIcon />}
                            onClick={() => setScheduleOpen(true)}
                            variant="outlined"
                            size="sm"
                            disabled={!hasLicense}
                        >
                            Schedule
                        </Button>
                    </Box>
                </Box>

                {!hasLicense && (
                    <Alert color="warning" variant="soft" startDecorator={<WarningIcon />} sx={{ mb: 2 }}>
                        <Box>
                            <Typography level="title-sm">License Required for Actions</Typography>
                            <Typography level="body-sm">
                                You can view your existing backups, but creating new backups or restoring requires an active Enterprise license.
                                <Button
                                    size="sm"
                                    variant="plain"
                                    color="warning"
                                    sx={{ ml: 1, p: 0, minHeight: 'auto', fontSize: 'inherit' }}
                                    onClick={() => window.location.href = '/settings?tab=license'}
                                >
                                    Renew license →
                                </Button>
                            </Typography>
                        </Box>
                    </Alert>
                )}

                <Divider />

                {/* If there is no active license we intentionally hide the tables
                    and schedules. The buttons remain visible but disabled so the
                    user is aware these features exist and can activate a license. */}

                {/* Always show tabs so users can see existing backups (Data Preservation) */}
                <Tabs value={tabValue} onChange={(_, value) => setTabValue(value as number)} sx={{ mt: 2 }}>
                    <TabList>
                        <Tab>Backups</Tab>
                        <Tab>Schedules</Tab>
                    </TabList>
                    <TabPanel value={0} sx={{ p: 0, pt: 2 }}>
                        <Table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Progress</th>
                                    <th>Size</th>
                                    <th>Created</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {backups.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                                            <Typography color="neutral">No backups found</Typography>
                                        </td>
                                    </tr>
                                ) : (
                                    backups.map((backup) => (
                                        <tr key={backup.id} style={{ opacity: !hasLicense ? 0.7 : 1 }}>
                                            <td>
                                                <Typography level="body-sm">{backup.name}</Typography>
                                                {backup.description && (
                                                    <Typography level="body-xs" color="neutral">{backup.description}</Typography>
                                                )}
                                            </td>
                                            <td>
                                                <Chip size="sm" variant="soft">{backup.type}</Chip>
                                            </td>
                                            <td>
                                                <Chip size="sm" color={getStatusColor(backup.status)}>
                                                    {backup.status}
                                                </Chip>
                                            </td>
                                            <td style={{ width: '150px' }}>
                                                {backup.status === 'running' ? (
                                                    <Box>
                                                        <LinearProgress
                                                            determinate
                                                            value={backup.progressPercent || 0}
                                                            size="sm"
                                                        />
                                                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>
                                                            {backup.currentStep || 'Processing...'}
                                                        </Typography>
                                                    </Box>
                                                ) : (
                                                    <Typography level="body-sm">
                                                        {backup.progressPercent || 0}%
                                                    </Typography>
                                                )}
                                            </td>
                                            <td>
                                                <Typography level="body-sm">{formatSize(backup.sizeBytes)}</Typography>
                                            </td>
                                            <td>
                                                <Typography level="body-sm">{formatDate(backup.createdAt)}</Typography>
                                            </td>
                                            <td>
                                                <Box sx={{ display: 'flex', gap: 1 }}>
                                                    {backup.status === 'completed' && (
                                                        <IconButton
                                                            size="sm"
                                                            color="primary"
                                                            onClick={() => handleRestoreBackup(backup.id)}
                                                            title={hasLicense ? "Restore" : "License required to restore"}
                                                            disabled={!hasLicense}
                                                        >
                                                            <RestoreIcon />
                                                        </IconButton>
                                                    )}
                                                    <IconButton
                                                        size="sm"
                                                        color="danger"
                                                        onClick={() => handleDeleteBackup(backup.id)}
                                                        title={hasLicense ? "Delete" : "License required to delete"}
                                                        disabled={!hasLicense}
                                                    >
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </Box>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </Table>
                    </TabPanel>
                    <TabPanel value={1} sx={{ p: 0, pt: 2 }}>
                        <Table>
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Frequency</th>
                                    <th>Type</th>
                                    <th>Status</th>
                                    <th>Last Run</th>
                                    <th>Next Run</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {schedules.length === 0 ? (
                                    <tr>
                                        <td colSpan={7} style={{ textAlign: 'center', padding: '2rem' }}>
                                            <Typography color="neutral">No schedules found</Typography>
                                        </td>
                                    </tr>
                                ) : (
                                    schedules.map((schedule) => (
                                        <tr key={schedule.id} style={{ opacity: !hasLicense ? 0.7 : 1 }}>
                                            <td>
                                                <Typography level="body-sm">{schedule.name}</Typography>
                                                {schedule.description && (
                                                    <Typography level="body-xs" color="neutral">{schedule.description}</Typography>
                                                )}
                                            </td>
                                            <td>
                                                <Chip size="sm" variant="soft">{schedule.frequency}</Chip>
                                            </td>
                                            <td>
                                                <Chip size="sm" variant="soft">{schedule.backupType}</Chip>
                                            </td>
                                            <td>
                                                <Chip size="sm" color={schedule.enabled ? 'success' : 'neutral'}>
                                                    {schedule.enabled ? 'Enabled' : 'Disabled'}
                                                </Chip>
                                            </td>
                                            <td>
                                                <Typography level="body-sm">{formatDate(schedule.lastRunAt)}</Typography>
                                            </td>
                                            <td>
                                                <Typography level="body-sm">{formatDate(schedule.nextRunAt)}</Typography>
                                            </td>
                                            <td>
                                                <IconButton
                                                    size="sm"
                                                    color="danger"
                                                    onClick={() => handleDeleteSchedule(schedule.id)}
                                                    title={hasLicense ? "Delete" : "License required to delete"}
                                                    disabled={!hasLicense}
                                                >
                                                    <DeleteIcon />
                                                </IconButton>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </Table>
                    </TabPanel>
                </Tabs>
            </CardContent>

            {/* Create Backup Modal */}
            <Modal open={createOpen} onClose={() => setCreateOpen(false)}>
                <ModalDialog>
                    <ModalClose />
                    <Typography level="h4">Create Backup</Typography>
                    <Stack spacing={2} sx={{ mt: 2 }}>
                        <FormControl required>
                            <FormLabel>Name</FormLabel>
                            <Input
                                value={backupName}
                                onChange={(e) => setBackupName(e.target.value)}
                                placeholder="Production backup"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel>Description</FormLabel>
                            <Textarea
                                value={backupDesc}
                                onChange={(e) => setBackupDesc(e.target.value)}
                                placeholder="Optional description"
                                minRows={2}
                            />
                        </FormControl>

                        <FormControl required>
                            <FormLabel>Backup Type</FormLabel>
                            <Select value={backupType} onChange={(_, val) => setBackupType(val as any)}>
                                <Option value="full">Full</Option>
                                <Option value="incremental">Incremental</Option>
                                <Option value="differential">Differential</Option>
                            </Select>
                        </FormControl>

                        <FormControl required>
                            <FormLabel>Storage Destination</FormLabel>
                            <Select
                                value={storageConfigId}
                                onChange={(_, val) => setStorageConfigId(val as string)}
                                placeholder="Select storage..."
                            >
                                {storageConfigs
                                    .filter((config) => config.usage === 'backup')
                                    .map((config) => (
                                        <Option key={config.id} value={config.id}>
                                            {config.key} ({config.type})
                                        </Option>
                                    ))}
                            </Select>
                        </FormControl>

                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
                            <Button variant="plain" color="neutral" onClick={() => setCreateOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleCreateBackup}>Create</Button>
                        </Box>
                    </Stack>
                </ModalDialog>
            </Modal>

            {/* Create Schedule Modal */}
            <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)}>
                <ModalDialog>
                    <ModalClose />
                    <Typography level="h4">Create Backup Schedule</Typography>
                    <Stack spacing={2} sx={{ mt: 2 }}>
                        <FormControl required>
                            <FormLabel>Name</FormLabel>
                            <Input
                                value={scheduleName}
                                onChange={(e) => setScheduleName(e.target.value)}
                                placeholder="Daily backup"
                            />
                        </FormControl>

                        <FormControl>
                            <FormLabel>Description</FormLabel>
                            <Textarea
                                value={scheduleDesc}
                                onChange={(e) => setScheduleDesc(e.target.value)}
                                placeholder="Optional description"
                                minRows={2}
                            />
                        </FormControl>

                        <FormControl required>
                            <FormLabel>Frequency</FormLabel>
                            <Select value={scheduleFrequency} onChange={(_, val) => setScheduleFrequency(val as any)}>
                                <Option value="hourly">Hourly</Option>
                                <Option value="daily">Daily</Option>
                                <Option value="weekly">Weekly</Option>
                                <Option value="monthly">Monthly</Option>
                            </Select>
                        </FormControl>

                        <FormControl required>
                            <FormLabel>Backup Type</FormLabel>
                            <Select value={scheduleBackupType} onChange={(_, val) => setScheduleBackupType(val as any)}>
                                <Option value="full">Full</Option>
                                <Option value="incremental">Incremental</Option>
                                <Option value="differential">Differential</Option>
                            </Select>
                        </FormControl>

                        <FormControl required>
                            <FormLabel>Storage Destination</FormLabel>
                            <Select
                                value={scheduleStorageId}
                                onChange={(_, val) => setScheduleStorageId(val as string)}
                                placeholder="Select storage..."
                            >
                                {storageConfigs
                                    .filter((config) => config.usage === 'backup')
                                    .map((config) => (
                                        <Option key={config.id} value={config.id}>
                                            {config.key} ({config.type})
                                        </Option>
                                    ))}
                            </Select>
                        </FormControl>

                        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
                            <Button variant="plain" color="neutral" onClick={() => setScheduleOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleCreateSchedule}>Create</Button>
                        </Box>
                    </Stack>
                </ModalDialog>
            </Modal>

            <ConfirmationModal
                open={confirmAction.open}
                onClose={() => setConfirmAction(prev => ({ ...prev, open: false }))}
                onConfirm={confirmAction.onConfirm}
                title={confirmAction.title}
                message={confirmAction.message}
                color={confirmAction.color}
            />
        </Card>
    )
}
