import { useEffect, useState } from 'react';
import { Typography, Box, Card, CardContent, List, ListItem, ListItemContent, IconButton, Chip, Divider, Button, Modal, ModalDialog, DialogTitle, DialogContent, Stack, FormControl, FormLabel, Select, Option } from '@mui/joy';
import PersonIcon from '@mui/icons-material/Person';
import SecurityIcon from '@mui/icons-material/Security';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import LockIcon from '@mui/icons-material/Lock';
import axios from 'axios';
import { useNotification } from '../NotificationSystem';
import ConfirmationModal from '../ConfirmationModal';

interface RepositoryPermissionsProps {
    repositoryId: string;
    repositoryName: string;
}

export default function RepositoryPermissions({ repositoryId, repositoryName }: RepositoryPermissionsProps) {
    const [permissions, setPermissions] = useState<any[]>([]);
    const [users, setUsers] = useState<any[]>([]);
    const [roles, setRoles] = useState<any[]>([]);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [grantType, setGrantType] = useState<'user' | 'role'>('user');
    const [selectedUserId, setSelectedUserId] = useState('');
    const [selectedRoleId, setSelectedRoleId] = useState('');
    const [selectedPermission, setSelectedPermission] = useState<'read' | 'write' | 'admin'>('read');
    const [loading, setLoading] = useState(false);
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

    const fetchPermissions = () => {
        axios.get(`/api/repositories/${repositoryId}/permissions`)
            .then((res) => setPermissions(res.data))
            .catch(() => notify('Failed to load permissions'));
    };

    const fetchUsers = () => {
        axios.get('/api/users')
            .then((res) => setUsers(res.data))
            .catch(() => { });
    };

    const fetchRoles = () => {
        axios.get('/api/rbac/roles')
            .then((res) => setRoles(res.data))
            .catch(() => { });
    };

    useEffect(() => {
        fetchPermissions();
        fetchUsers();
        fetchRoles();
    }, [repositoryId]);

    const handleGrant = async () => {
        setLoading(true);
        try {
            if (grantType === 'user') {
                if (!selectedUserId) {
                    notify('Please select a user');
                    return;
                }
                await axios.post(`/api/repositories/${repositoryId}/permissions/user`, {
                    userId: selectedUserId,
                    permission: selectedPermission,
                });
            } else {
                if (!selectedRoleId) {
                    notify('Please select a role');
                    return;
                }
                await axios.post(`/api/repositories/${repositoryId}/permissions/role`, {
                    roleId: selectedRoleId,
                    permission: selectedPermission,
                });
            }
            notify('Permission granted successfully');
            setDialogOpen(false);
            fetchPermissions();
            setSelectedUserId('');
            setSelectedRoleId('');
        } catch (err: any) {
            notify(err?.response?.data?.message || 'Failed to grant permission');
        } finally {
            setLoading(false);
        }
    };

    const handleRevoke = async (permissionId: string) => {
        setConfirmAction({
            open: true,
            title: 'Revoke Permission',
            message: 'Are you sure you want to revoke this permission?',
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/repositories/${repositoryId}/permissions/${permissionId}`);
                    notify('Permission revoked successfully');
                    fetchPermissions();
                } catch (err) {
                    notify('Failed to revoke permission');
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    const getPermissionColor = (permission: string) => {
        switch (permission) {
            case 'admin': return 'danger';
            case 'write': return 'warning';
            case 'read': return 'success';
            default: return 'neutral';
        }
    };

    return (
        <Box>
            <Card variant="outlined">
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Box>
                            <Typography level="title-md">Repository Permissions</Typography>
                            <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                Manage who can access "{repositoryName}"
                            </Typography>
                        </Box>
                        <Button
                            startDecorator={<AddIcon />}
                            size="sm"
                            onClick={() => setDialogOpen(true)}
                        >
                            Grant Permission
                        </Button>
                    </Box>

                    <Divider />

                    <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem' }}>
                        {permissions.map((perm) => (
                            <ListItem
                                key={perm.id}
                                sx={{
                                    borderRadius: 'sm',
                                    mb: 0.5,
                                    '&:hover': {
                                        bgcolor: 'background.level1'
                                    }
                                }}
                                endAction={
                                    <IconButton
                                        size="sm"
                                        variant="soft"
                                        color="danger"
                                        onClick={() => handleRevoke(perm.id)}
                                    >
                                        <DeleteIcon />
                                    </IconButton>
                                }
                            >
                                <Box sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 40,
                                    height: 40,
                                    borderRadius: 'sm',
                                    bgcolor: perm.user ? 'primary.softBg' : 'success.softBg',
                                    mr: 2
                                }}>
                                    {perm.user ? (
                                        <PersonIcon sx={{ color: 'primary.solidBg' }} />
                                    ) : (
                                        <SecurityIcon sx={{ color: 'success.solidBg' }} />
                                    )}
                                </Box>
                                <ListItemContent>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                            <Typography level="title-sm">
                                                {perm.user ? perm.user.username : perm.role?.name}
                                            </Typography>
                                            <Chip size="sm" variant="soft" color={perm.user ? 'primary' : 'success'}>
                                                {perm.user ? 'User' : 'Role'}
                                            </Chip>
                                        </Box>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <LockIcon sx={{ fontSize: 14, color: 'text.tertiary' }} />
                                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                Permission:
                                            </Typography>
                                            <Chip
                                                size="sm"
                                                variant="solid"
                                                color={getPermissionColor(perm.permission)}
                                            >
                                                {perm.permission.toUpperCase()}
                                            </Chip>
                                        </Box>
                                    </Box>
                                </ListItemContent>
                            </ListItem>
                        ))}
                        {permissions.length === 0 && (
                            <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <LockIcon sx={{ fontSize: 48, color: 'neutral.400', mb: 1 }} />
                                    <Typography level="body-md" color="neutral">No permissions configured</Typography>
                                    <Typography level="body-sm" color="neutral" sx={{ mt: 0.5 }}>
                                        Grant permissions to users or roles to control access
                                    </Typography>
                                </Box>
                            </ListItem>
                        )}
                    </List>
                </CardContent>
            </Card>

            {/* Grant Permission Dialog */}
            <Modal open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <ModalDialog sx={{ minWidth: 500 }}>
                    <DialogTitle>Grant Permission</DialogTitle>
                    <DialogContent>
                        Configure access to "{repositoryName}"
                    </DialogContent>
                    <Stack spacing={2}>
                        <FormControl>
                            <FormLabel>Grant to</FormLabel>
                            <Select
                                value={grantType}
                                onChange={(_, value) => setGrantType(value as 'user' | 'role')}
                            >
                                <Option value="user">User</Option>
                                <Option value="role">Role</Option>
                            </Select>
                        </FormControl>

                        {grantType === 'user' ? (
                            <FormControl required>
                                <FormLabel>Select User</FormLabel>
                                <Select
                                    placeholder="Choose a user..."
                                    value={selectedUserId}
                                    onChange={(_, value) => setSelectedUserId(value as string)}
                                >
                                    {users.map((user) => (
                                        <Option key={user.id} value={user.id}>
                                            {user.username} {user.displayName && `(${user.displayName})`}
                                        </Option>
                                    ))}
                                </Select>
                            </FormControl>
                        ) : (
                            <FormControl required>
                                <FormLabel>Select Role</FormLabel>
                                <Select
                                    placeholder="Choose a role..."
                                    value={selectedRoleId}
                                    onChange={(_, value) => setSelectedRoleId(value as string)}
                                >
                                    {roles.map((role) => (
                                        <Option key={role.id} value={role.id}>
                                            {role.name}
                                        </Option>
                                    ))}
                                </Select>
                            </FormControl>
                        )}

                        <FormControl required>
                            <FormLabel>Permission Level</FormLabel>
                            <Select
                                value={selectedPermission}
                                onChange={(_, value) => setSelectedPermission(value as 'read' | 'write' | 'admin')}
                            >
                                <Option value="read">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="sm" color="success">READ </Chip>
                                        <Typography level="body-sm">Can download/pull packages</Typography>
                                    </Box>
                                </Option>
                                <Option value="write">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="sm" color="warning">WRITE </Chip>
                                        <Typography level="body-sm">Can upload/push packages</Typography>
                                    </Box>
                                </Option>
                                <Option value="admin">
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Chip size="sm" color="danger">ADMIN </Chip>
                                        <Typography level="body-sm">Can manage repository settings</Typography>
                                    </Box>
                                </Option>
                            </Select>
                        </FormControl>

                        <Button onClick={handleGrant} loading={loading}>
                            Grant Permission
                        </Button>
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
        </Box>
    );
}
