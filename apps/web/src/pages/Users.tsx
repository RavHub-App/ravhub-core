import { useEffect, useState } from 'react'
import { Typography, Box, Button, Card, CardContent, List, ListItem, ListItemContent, Avatar, IconButton, Chip, Divider } from '@mui/joy'
import AddIcon from '@mui/icons-material/Add'
import PersonIcon from '@mui/icons-material/Person'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import axios from 'axios'
import UserDialog from '../components/Users/UserDialog'
import { useNotification } from '../components/NotificationSystem'
import ConfirmationModal from '../components/ConfirmationModal'

export default function Users() {
    const [users, setUsers] = useState<any[]>([])
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedUser, setSelectedUser] = useState<any>(null)
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

    const fetchUsers = () => {
        axios.get('/api/users').then((res) => setUsers(res.data)).catch(() => { })
    }

    useEffect(() => {
        fetchUsers()
    }, [])

    const handleCreate = () => {
        setSelectedUser(null)
        setDialogOpen(true)
    }

    const handleEdit = (user: any) => {
        setSelectedUser(user)
        setDialogOpen(true)
    }

    const handleDelete = async (user: any) => {
        setConfirmAction({
            open: true,
            title: 'Delete User',
            message: `Are you sure you want to delete ${user.username}?`,
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/users/${user.id}`)
                    notify('User deleted successfully')
                    fetchUsers()
                } catch (err) {
                    console.error(err)
                    notify('Failed to delete user')
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography level="h2">Users</Typography>
                    <Typography level="body-md" color="neutral">Manage system users and access control</Typography>
                </Box>
                <Button startDecorator={<AddIcon />} onClick={handleCreate}>
                    Create User
                </Button>
            </Box>

            <Card variant="outlined">
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography level="title-md">User Accounts</Typography>
                        <Typography level="body-sm" color="neutral">
                            {users.length} {users.length === 1 ? 'user' : 'users'}
                        </Typography>
                    </Box>
                    <Divider />
                    <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem' }}>
                        {users.map((u) => (
                            <ListItem
                                key={u.id}
                                sx={{
                                    borderRadius: 'sm',
                                    mb: 0.5,
                                    '&:hover': {
                                        bgcolor: 'background.level1'
                                    }
                                }}
                                endAction={
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <IconButton size="sm" variant="soft" color="neutral" onClick={() => handleEdit(u)}>
                                            <EditIcon />
                                        </IconButton>
                                        <IconButton size="sm" variant="soft" color="danger" onClick={() => handleDelete(u)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </Box>
                                }
                            >
                                <Avatar size="sm" sx={{ mr: 2 }}>
                                    <PersonIcon />
                                </Avatar>
                                <ListItemContent>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                            <Typography level="title-sm">{u.username || u.name}</Typography>
                                            {u.displayName && (
                                                <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                    ({u.displayName})
                                                </Typography>
                                            )}
                                        </Box>
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <AdminPanelSettingsIcon sx={{ fontSize: 16, color: 'text.tertiary' }} />
                                                <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                    Roles:
                                                </Typography>
                                            </Box>
                                            {u.roles && u.roles.length > 0 ? (
                                                u.roles.map((r: any) => (
                                                    <Chip key={r.id} size="sm" variant="soft" color="primary">
                                                        {r.name}
                                                    </Chip>
                                                ))
                                            ) : (
                                                <Typography level="body-xs" sx={{ color: 'text.tertiary', fontStyle: 'italic' }}>
                                                    No roles assigned
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                </ListItemContent>
                            </ListItem>
                        ))}
                        {users.length === 0 && (
                            <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <PersonIcon sx={{ fontSize: 48, color: 'neutral.400', mb: 1 }} />
                                    <Typography level="body-md" color="neutral">No users found</Typography>
                                    <Typography level="body-sm" color="neutral" sx={{ mt: 0.5 }}>
                                        Create your first user to get started
                                    </Typography>
                                </Box>
                            </ListItem>
                        )}
                    </List>
                </CardContent>
            </Card>

            <UserDialog
                open={dialogOpen}
                onClose={() => setDialogOpen(false)}
                onSaved={fetchUsers}
                user={selectedUser}
            />

            <ConfirmationModal
                open={confirmAction.open}
                onClose={() => setConfirmAction(prev => ({ ...prev, open: false }))}
                onConfirm={confirmAction.onConfirm}
                title={confirmAction.title}
                message={confirmAction.message}
                color={confirmAction.color}
            />
        </Box>
    )
}
