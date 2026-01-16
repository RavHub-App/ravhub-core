import { useEffect, useState } from 'react';
import { Typography, Card, CardContent, Divider, List, ListItem, ListItemContent, Button, Modal, ModalDialog, DialogTitle, DialogContent, Stack, FormControl, FormLabel, Input, Select, Option, IconButton, Box, Checkbox, Grid, Chip, Alert } from '@mui/joy';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import FolderIcon from '@mui/icons-material/Folder';
import StorageIcon from '@mui/icons-material/Storage';
import InfoIcon from '@mui/icons-material/Info';
import MoveToInboxIcon from '@mui/icons-material/MoveToInbox';
import axios from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { hasGlobalPermission } from '../Repos/repo-permissions';
import { useNotification } from '../NotificationSystem';
import ConfirmationModal from '../ConfirmationModal';

export default function StorageSettings() {
    const [configs, setConfigs] = useState<any[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [hasLicense, setHasLicense] = useState<boolean>(false);
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

    // Form state
    const [key, setKey] = useState('');
    const [type, setType] = useState('filesystem');
    const [usage, setUsage] = useState('repository');
    const [isDefault, setIsDefault] = useState(false);

    // Config specific fields
    const [fsBasePath, setFsBasePath] = useState('');
    const [s3Bucket, setS3Bucket] = useState('');
    const [s3Region, setS3Region] = useState('');
    const [s3Endpoint, setS3Endpoint] = useState('');
    const [s3AccessKey, setS3AccessKey] = useState('');
    const [s3SecretKey, setS3SecretKey] = useState('');

    // GCS
    const [gcsBucket, setGcsBucket] = useState('');
    const [gcsProjectId, setGcsProjectId] = useState('');
    const [gcsCredentials, setGcsCredentials] = useState('');

    // Azure
    const [azureContainer, setAzureContainer] = useState('');
    const [azureConnectionString, setAzureConnectionString] = useState('');

    const { user } = useAuth();
    const canManage = Boolean(
        user && (
            hasGlobalPermission(user, 'system.admin') || user.roles?.includes('admin') || user.roles?.includes('superadmin')
        ),
    );

    const fetchConfigs = () => {
        axios.get('/api/storage/configs').then(res => setConfigs(res.data)).catch(() => { });
    };

    const checkLicense = async () => {
        try {
            const response = await axios.get('/api/licenses');
            setHasLicense(response.data.isActive === true);
        } catch (err) {
            setHasLicense(false);
        }
    };

    useEffect(() => {
        fetchConfigs();
        checkLicense();
    }, []);

    const handleOpen = (existing?: any) => {
        if (existing) {
            setEditingId(existing.id);
            setKey(existing.key);
            setType(existing.type);
            setUsage(existing.usage || 'repository');
            setIsDefault(existing.isDefault || false);

            const cfg = existing.config || {};
            if (existing.type === 'filesystem') {
                setFsBasePath(cfg.basePath || '');
            } else if (existing.type === 's3') {
                setS3Bucket(cfg.bucket || '');
                setS3Region(cfg.region || '');
                setS3Endpoint(cfg.endpoint || '');
                setS3AccessKey(cfg.accessKeyId || '');
                setS3SecretKey(cfg.secretAccessKey || '');
            } else if (existing.type === 'gcs') {
                setGcsBucket(cfg.bucket || '');
                setGcsProjectId(cfg.projectId || '');
                setGcsCredentials(cfg.credentials ? JSON.stringify(cfg.credentials) : '');
            } else if (existing.type === 'azure') {
                setAzureContainer(cfg.container || '');
                setAzureConnectionString(cfg.connectionString || '');
            }
        } else {
            setEditingId(null);
            setKey('');
            setType('filesystem');
            setUsage('repository');
            setIsDefault(false);
            setFsBasePath('');
            setS3Bucket('');
            setS3Region('');
            setS3Endpoint('');
            setS3AccessKey('');
            setS3SecretKey('');
            setGcsBucket('');
            setGcsProjectId('');
            setGcsCredentials('');
            setAzureContainer('');
            setAzureConnectionString('');
        }
        setOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        try {
            let configPayload: any = {};
            if (type === 'filesystem') {
                if (fsBasePath) configPayload.basePath = fsBasePath;
            } else if (type === 's3') {
                configPayload = {
                    bucket: s3Bucket,
                    region: s3Region,
                    endpoint: s3Endpoint,
                    accessKeyId: s3AccessKey,
                    secretAccessKey: s3SecretKey
                };
            } else if (type === 'gcs') {
                configPayload = {
                    bucket: gcsBucket,
                    projectId: gcsProjectId,
                    credentials: gcsCredentials ? JSON.parse(gcsCredentials) : undefined,
                };
            } else if (type === 'azure') {
                configPayload = {
                    container: azureContainer,
                    connectionString: azureConnectionString,
                };
            }

            const payload = {
                key,
                type,
                usage,
                isDefault,
                config: configPayload
            };

            if (editingId) {
                await axios.put(`/api/storage/configs/${editingId}`, payload);
                notify('Storage config updated');
            } else {
                await axios.post('/api/storage/configs', payload);
                notify('Storage config created');
            }
            setOpen(false);
            fetchConfigs();
        } catch (err: any) {
            console.error(err);
            notify(err?.response?.data?.message || 'Failed to save storage config');
        } finally {
            setLoading(false);
        }
    };

    const handleMigrate = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Migrate Assets',
            message: 'Migrate all repository assets to this storage? This may take a while.',
            color: 'warning',
            onConfirm: async () => {
                try {
                    await axios.post('/api/storage/configs/migrate-system', { newStorageId: id });
                    notify('Migration started');
                    fetchConfigs();
                } catch (err: any) {
                    console.error(err);
                    notify('Failed to start migration');
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    const handleDelete = async (id: string) => {
        setConfirmAction({
            open: true,
            title: 'Delete Storage Config',
            message: 'Are you sure you want to delete this storage configuration?',
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/storage/configs/${id}`);
                    notify('Storage config deleted');
                    fetchConfigs();
                } catch (err: any) {
                    console.error(err);
                    notify('Failed to delete storage config');
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
                        <StorageIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                        <Box>
                            <Typography level="title-md">Storage Configurations</Typography>
                            <Typography level="body-sm">Manage backend storage for repositories and backups.</Typography>
                        </Box>
                    </Box>
                    {canManage ? (
                        <Button startDecorator={<AddIcon />} size="sm" onClick={() => handleOpen()}>Add Config</Button>
                    ) : (
                        <Typography level="body-xs" color="neutral">Only admins can manage storage backends</Typography>
                    )}
                </Box>

                {!hasLicense && (
                    <Alert color="warning" variant="soft" startDecorator={<InfoIcon />} sx={{ mb: 2 }}>
                        <Box>
                            <Typography level="body-sm">
                                Enterprise storage options (S3, GCS, Azure) require an active license. Filesystem storage is always available.
                            </Typography>
                        </Box>
                    </Alert>
                )}

                <Divider />
                <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem' }}>
                    {configs.map((c: any) => (
                        <ListItem
                            key={c.id}
                            sx={{
                                borderRadius: 'sm',
                                mb: 0.5,
                                '&:hover': {
                                    bgcolor: 'background.level1'
                                }
                            }}
                            endAction={
                                <Box sx={{ display: 'flex', gap: 1 }}>
                                    {canManage && (
                                        <>
                                            <IconButton size="sm" variant="soft" color="neutral" onClick={() => handleOpen(c)}>
                                                <EditIcon />
                                            </IconButton>
                                            <IconButton size="sm" variant="soft" color="danger" onClick={() => handleDelete(c.id)}>
                                                <DeleteIcon />
                                            </IconButton>
                                        </>
                                    )}
                                </Box>
                            }>
                            <ListItemContent>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Typography level="title-sm">{c.key}</Typography>
                                        {c.isDefault && (
                                            <Chip
                                                size="sm"
                                                color="success"
                                                variant="soft"
                                                sx={{
                                                    fontSize: '0.7rem'
                                                }}
                                            >
                                                Default
                                            </Chip>
                                        )}
                                        {c.usage && (
                                            <Chip
                                                size="sm"
                                                color="primary"
                                                variant="soft"
                                                sx={{
                                                    fontSize: '0.7rem',
                                                }}
                                            >
                                                {c.usage}
                                            </Chip>
                                        )}
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                                        <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                            Type: <strong>{c.type}</strong>
                                        </Typography>
                                        {c.stats && (
                                            <>
                                                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>•</Typography>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                    <FolderIcon sx={{ fontSize: 14, color: 'text.tertiary' }} />
                                                    <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                        {c.stats.repositoryCount || 0} {
                                                            c.usage === 'backup' ? (c.stats.repositoryCount === 1 ? 'backup' : 'backups') :
                                                                (c.stats.repositoryCount === 1 ? 'repository' : 'repositories')
                                                        }
                                                    </Typography>
                                                </Box>
                                                {c.stats.totalSize !== undefined && (
                                                    <>
                                                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>•</Typography>
                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                            <StorageIcon sx={{ fontSize: 14, color: 'text.tertiary' }} />
                                                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                                {(c.stats.totalSize / 1024 / 1024 / 1024).toFixed(2)} GB
                                                            </Typography>
                                                        </Box>
                                                    </>
                                                )}
                                            </>
                                        )}
                                    </Box>
                                    {/* Read-only mode indicator for enterprise storage without license */}
                                    {!hasLicense && ['s3', 'gcs', 'azure'].includes(c.type) && (
                                        <Alert
                                            color="warning"
                                            variant="soft"
                                            size="sm"
                                            sx={{ mt: 1, py: 0.5 }}
                                        >
                                            <Typography level="body-xs">
                                                ⚠️ <strong>READ-ONLY MODE:</strong> Existing data can be downloaded, but uploads are blocked.
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
                                        </Alert>
                                    )}
                                </Box>
                            </ListItemContent>
                        </ListItem>
                    ))}
                    {configs.length === 0 && (
                        <ListItem>
                            <Typography level="body-sm" color="neutral">No storage configs found</Typography>
                        </ListItem>
                    )}
                </List>
            </CardContent>

            <Modal open={open} onClose={() => setOpen(false)}>
                <ModalDialog sx={{ minWidth: 500, maxWidth: 600 }}>
                    <DialogTitle>{editingId ? 'Edit Storage' : 'Add Storage'}</DialogTitle>
                    <DialogContent>Configure storage backend.</DialogContent>
                    <form onSubmit={handleSubmit}>
                        <Stack spacing={2}>
                            <Grid container spacing={2}>
                                <Grid xs={12} sm={6}>
                                    <FormControl required>
                                        <FormLabel>Key</FormLabel>
                                        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="e.g. s3-production" />
                                    </FormControl>
                                </Grid>
                                <Grid xs={12} sm={6}>
                                    <FormControl required>
                                        <FormLabel>Type</FormLabel>
                                        <Select value={type} onChange={(_, val) => setType(val as string)}>
                                            <Option value="filesystem">Filesystem</Option>
                                            <Option value="s3" disabled={!hasLicense}>
                                                S3 Compatible {!hasLicense && '(Requires License)'}
                                            </Option>
                                            <Option value="gcs" disabled={!hasLicense}>
                                                Google Cloud Storage {!hasLicense && '(Requires License)'}
                                            </Option>
                                            <Option value="azure" disabled={!hasLicense}>
                                                Azure Blob {!hasLicense && '(Requires License)'}
                                            </Option>
                                        </Select>
                                    </FormControl>
                                </Grid>
                                <Grid xs={12} sm={4}>
                                    <FormControl required>
                                        <FormLabel>Usage</FormLabel>
                                        <Select value={usage} onChange={(_, val) => setUsage(val as string)}>
                                            <Option value="repository">Repository</Option>
                                            <Option value="backup">Backup</Option>
                                        </Select>
                                    </FormControl>
                                </Grid>
                            </Grid>

                            <FormControl>
                                <Checkbox label="Set as default storage" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
                            </FormControl>

                            <Divider>Configuration</Divider>

                            {type === 'filesystem' && (
                                <FormControl>
                                    <FormLabel>Base Path (Optional)</FormLabel>
                                    <Input value={fsBasePath} onChange={(e) => setFsBasePath(e.target.value)} placeholder="/data/storage (defaults to system setting)" />
                                </FormControl>
                            )}

                            {type === 's3' && (
                                <Stack spacing={2}>
                                    <Grid container spacing={2}>
                                        <Grid xs={12} sm={6}>
                                            <FormControl required>
                                                <FormLabel>Bucket</FormLabel>
                                                <Input value={s3Bucket} onChange={(e) => setS3Bucket(e.target.value)} placeholder="my-bucket" />
                                            </FormControl>
                                        </Grid>
                                        <Grid xs={12} sm={6}>
                                            <FormControl>
                                                <FormLabel>Region</FormLabel>
                                                <Input value={s3Region} onChange={(e) => setS3Region(e.target.value)} placeholder="us-east-1" />
                                            </FormControl>
                                        </Grid>
                                    </Grid>
                                    <FormControl>
                                        <FormLabel>Endpoint (Optional)</FormLabel>
                                        <Input value={s3Endpoint} onChange={(e) => setS3Endpoint(e.target.value)} placeholder="https://s3.amazonaws.com" />
                                    </FormControl>
                                    <Grid container spacing={2}>
                                        <Grid xs={12} sm={6}>
                                            <FormControl>
                                                <FormLabel>Access Key ID</FormLabel>
                                                <Input value={s3AccessKey} onChange={(e) => setS3AccessKey(e.target.value)} type="password" />
                                            </FormControl>
                                        </Grid>
                                        <Grid xs={12} sm={6}>
                                            <FormControl>
                                                <FormLabel>Secret Access Key</FormLabel>
                                                <Input value={s3SecretKey} onChange={(e) => setS3SecretKey(e.target.value)} type="password" />
                                            </FormControl>
                                        </Grid>
                                    </Grid>
                                </Stack>
                            )}

                            {type === 'gcs' && (
                                <Stack spacing={2}>
                                    <Grid container spacing={2}>
                                        <Grid xs={12} sm={6}>
                                            <FormControl required>
                                                <FormLabel>Bucket</FormLabel>
                                                <Input value={gcsBucket} onChange={(e) => setGcsBucket(e.target.value)} placeholder="my-gcs-bucket" />
                                            </FormControl>
                                        </Grid>
                                        <Grid xs={12} sm={6}>
                                            <FormControl>
                                                <FormLabel>Project ID</FormLabel>
                                                <Input value={gcsProjectId} onChange={(e) => setGcsProjectId(e.target.value)} placeholder="project-id" />
                                            </FormControl>
                                        </Grid>
                                    </Grid>
                                    <FormControl>
                                        <FormLabel>Credentials (JSON)</FormLabel>
                                        <Input value={gcsCredentials} onChange={(e) => setGcsCredentials(e.target.value)} placeholder='{"client_email": ... }' />
                                    </FormControl>
                                </Stack>
                            )}

                            {type === 'azure' && (
                                <Stack spacing={2}>
                                    <Grid container spacing={2}>
                                        <Grid xs={12} sm={6}>
                                            <FormControl required>
                                                <FormLabel>Container</FormLabel>
                                                <Input value={azureContainer} onChange={(e) => setAzureContainer(e.target.value)} placeholder="my-container" />
                                            </FormControl>
                                        </Grid>
                                        <Grid xs={12} sm={6}>
                                            <FormControl>
                                                <FormLabel>Connection string</FormLabel>
                                                <Input value={azureConnectionString} onChange={(e) => setAzureConnectionString(e.target.value)} placeholder="DefaultEndpointsProtocol=..." />
                                            </FormControl>
                                        </Grid>
                                    </Grid>
                                </Stack>
                            )}

                            <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 2 }}>
                                <Button variant="plain" color="neutral" onClick={() => setOpen(false)}>Cancel</Button>
                                <Button type="submit" loading={loading}>Save</Button>
                            </Box>
                        </Stack>
                    </form>
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
