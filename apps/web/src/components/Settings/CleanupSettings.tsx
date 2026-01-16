import { useState, useEffect } from 'react';
import { Box, Typography, Button, Table, Chip, IconButton, Modal, ModalDialog, FormControl, FormLabel, Input, Select, Option, Textarea, List, ListItem, ListItemButton, Checkbox, Grid, Card, CardContent, Divider } from '@mui/joy';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import axios from 'axios';
import { useNotification } from '../NotificationSystem';
import ConfirmationModal from '../ConfirmationModal';

export default function CleanupSettings() {
    const [policies, setPolicies] = useState([]);
    const [repositories, setRepositories] = useState([]);
    const [openModal, setOpenModal] = useState(false);
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        enabled: true,
        target: 'artifacts',
        strategy: 'age-based',
        maxAgeDays: 30,
        maxCount: 10,
        maxSizeBytes: 10737418240, // 10 GB
        repositoryIds: [] as string[],
        keepTagPattern: 'latest',
        frequency: 'daily',
        scheduleTime: '02:00',
    });
    const { notify } = useNotification();
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

    useEffect(() => {
        loadPolicies();
        loadRepositories();
        const interval = setInterval(loadPolicies, 10000);
        return () => clearInterval(interval);
    }, []);

    const loadPolicies = async () => {
        try {
            const { data } = await axios.get('/api/cleanup/policies');
            setPolicies(data);
        } catch (error) {
            console.error('Failed to load cleanup policies:', error);
        }
    };

    const loadRepositories = async () => {
        try {
            const { data } = await axios.get('/api/repositories');
            setRepositories(data);
        } catch (error) {
            console.error('Failed to load repositories:', error);
        }
    };

    const handleCreate = async () => {
        try {
            await axios.post('/api/cleanup/policies', formData);
            notify('Cleanup policy created successfully');
            setOpenModal(false);
            loadPolicies();
        } catch (error: any) {
            notify(error.response?.data?.message || 'Failed to create cleanup policy');
        }
    };

    const handleDelete = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Delete Policy',
            message: 'Are you sure you want to delete this cleanup policy?',
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/cleanup/policies/${id}`);
                    notify('Cleanup policy deleted');
                    loadPolicies();
                } catch (error: any) {
                    notify(error.response?.data?.message || 'Failed to delete policy');
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    const handleExecute = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Execute Cleanup',
            message: 'Are you sure you want to execute this cleanup policy now?',
            color: 'primary',
            onConfirm: async () => {
                try {
                    const { data } = await axios.post(`/api/cleanup/policies/${id}/execute`);
                    notify(`Cleanup completed: ${data.deleted} items deleted. ${(data.size / 1024 / 1024).toFixed(2)} MB freed`);
                    loadPolicies();
                } catch (error: any) {
                    notify(error.response?.data?.message || 'Failed to execute cleanup');
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    return (
        <Card variant="outlined">
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <CleaningServicesIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                        <Box>
                            <Typography level="title-md">Cleanup Policies</Typography>
                            <Typography level="body-sm">Automate artifact and blob cleanup.</Typography>
                        </Box>
                    </Box>
                    <Button startDecorator={<AddIcon />} size="sm" onClick={() => setOpenModal(true)}>Create Policy</Button>
                </Box>
                <Divider />

                <Table sx={{ mt: 2 }}>
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Target</th>
                            <th>Strategy</th>
                            <th>Schedule</th>
                            <th>Status</th>
                            <th>Last Run</th>
                            <th>Next Run</th>
                            <th style={{ width: 100 }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {policies.map((policy: any) => (
                            <tr key={policy.id}>
                                <td>{policy.name}</td>
                                <td><Chip size="sm">{policy.target}</Chip></td>
                                <td><Chip size="sm" variant="soft">{policy.strategy}</Chip></td>
                                <td>
                                    <Typography level="body-sm">
                                        {policy.frequency} at {policy.scheduleTime}
                                    </Typography>
                                </td>
                                <td><Chip color={policy.enabled ? 'success' : 'neutral'} size="sm">{policy.enabled ? 'Enabled' : 'Disabled'}</Chip></td>
                                <td><Typography level="body-sm">{policy.lastRunAt ? new Date(policy.lastRunAt).toLocaleString() : 'Never'}</Typography></td>
                                <td><Typography level="body-sm">{policy.nextRunAt ? new Date(policy.nextRunAt).toLocaleString() : 'N/A'}</Typography></td>
                                <td>
                                    <IconButton size="sm" color="primary" onClick={() => handleExecute(policy.id)}><PlayArrowIcon /></IconButton>
                                    <IconButton size="sm" color="danger" onClick={() => handleDelete(policy.id)}><DeleteIcon /></IconButton>
                                </td>
                            </tr>
                        ))}
                        {policies.length === 0 && (
                            <tr>
                                <td colSpan={8} style={{ textAlign: 'center', padding: '2rem' }}>
                                    <Typography level="body-sm" color="neutral">No cleanup policies configured</Typography>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </Table>
            </CardContent>

            <Modal open={openModal} onClose={() => setOpenModal(false)}>
                <ModalDialog sx={{ minWidth: 600, maxWidth: 800, maxHeight: '90vh', overflow: 'auto' }}>
                    <Typography level="h4">Create Cleanup Policy</Typography>

                    <FormControl>
                        <FormLabel>Name</FormLabel>
                        <Input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} />
                    </FormControl>

                    <FormControl>
                        <FormLabel>Description</FormLabel>
                        <Textarea value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                    </FormControl>

                    <Grid container spacing={2}>
                        <Grid xs={6}>
                            <FormControl>
                                <FormLabel>Target</FormLabel>
                                <Select value={formData.target} onChange={(_, v) => setFormData({ ...formData, target: v! })}>
                                    <Option value="artifacts">Artifacts</Option>
                                    <Option value="docker-blobs">Docker Blobs</Option>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid xs={6}>
                            <FormControl>
                                <FormLabel>Strategy</FormLabel>
                                <Select value={formData.strategy} onChange={(_, v) => setFormData({ ...formData, strategy: v! })}>
                                    <Option value="age-based">Age Based</Option>
                                    <Option value="count-based">Count Based</Option>
                                    <Option value="size-based">Size Based</Option>
                                </Select>
                            </FormControl>
                        </Grid>
                    </Grid>

                    {formData.strategy === 'age-based' && (
                        <FormControl>
                            <FormLabel>Delete artifacts older than (days)</FormLabel>
                            <Input type="number" value={formData.maxAgeDays} onChange={e => setFormData({ ...formData, maxAgeDays: parseInt(e.target.value) })} />
                        </FormControl>
                    )}

                    {formData.strategy === 'count-based' && (
                        <FormControl>
                            <FormLabel>Keep only last N artifacts</FormLabel>
                            <Input type="number" value={formData.maxCount} onChange={e => setFormData({ ...formData, maxCount: parseInt(e.target.value) })} />
                        </FormControl>
                    )}

                    {formData.strategy === 'size-based' && (
                        <FormControl>
                            <FormLabel>Max total size (GB)</FormLabel>
                            <Input
                                type="number"
                                value={(formData.maxSizeBytes / 1073741824).toFixed(2)}
                                onChange={e => setFormData({ ...formData, maxSizeBytes: Math.round(parseFloat(e.target.value) * 1073741824) })}
                            />
                        </FormControl>
                    )}

                    <FormControl>
                        <FormLabel>Repositories (leave empty for all)</FormLabel>
                        <Box sx={{ maxHeight: 200, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 'sm', p: 1 }}>
                            <List>
                                {repositories.map((repo: any) => (
                                    <ListItem key={repo.id}>
                                        <ListItemButton onClick={() => {
                                            const newIds = formData.repositoryIds.includes(repo.id)
                                                ? formData.repositoryIds.filter(id => id !== repo.id)
                                                : [...formData.repositoryIds, repo.id];
                                            setFormData({ ...formData, repositoryIds: newIds });
                                        }}>
                                            <Checkbox checked={formData.repositoryIds.includes(repo.id)} />
                                            <Typography sx={{ ml: 1 }}>{repo.name}</Typography>
                                        </ListItemButton>
                                    </ListItem>
                                ))}
                            </List>
                        </Box>
                    </FormControl>

                    <FormControl>
                        <FormLabel>Keep Tag Pattern (glob, e.g., latest, v*)</FormLabel>
                        <Input placeholder="e.g., latest, v*" value={formData.keepTagPattern} onChange={e => setFormData({ ...formData, keepTagPattern: e.target.value })} />
                    </FormControl>

                    <Grid container spacing={2}>
                        <Grid xs={6}>
                            <FormControl>
                                <FormLabel>Frequency</FormLabel>
                                <Select value={formData.frequency} onChange={(_, v) => setFormData({ ...formData, frequency: v! })}>
                                    <Option value="daily">Daily</Option>
                                    <Option value="weekly">Weekly</Option>
                                    <Option value="monthly">Monthly</Option>
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid xs={6}>
                            <FormControl>
                                <FormLabel>Time (HH:mm)</FormLabel>
                                <Input
                                    type="time"
                                    value={formData.scheduleTime}
                                    onChange={e => setFormData({ ...formData, scheduleTime: e.target.value })}
                                />
                            </FormControl>
                        </Grid>
                    </Grid>

                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 2 }}>
                        <Button variant="outlined" onClick={() => setOpenModal(false)}>Cancel</Button>
                        <Button onClick={handleCreate}>Create</Button>
                    </Box>
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
    );
}
