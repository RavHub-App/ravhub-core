import { useEffect, useState } from 'react'
import { Typography, Box, Button, Card, CardContent, List, ListItem, ListItemContent, IconButton, Chip, Divider, Modal, ModalDialog, DialogTitle, DialogContent, Stack, FormControl, FormLabel, Input, Checkbox } from '@mui/joy'
import AddIcon from '@mui/icons-material/Add'
import SecurityIcon from '@mui/icons-material/Security'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser'
import axios from 'axios'
import { useNotification } from '../components/NotificationSystem'
import ConfirmationModal from '../components/ConfirmationModal'

export default function Roles() {
    const [roles, setRoles] = useState<any[]>([])
    const [permissions, setPermissions] = useState<any[]>([])
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedRole, setSelectedRole] = useState<any>(null)
    const [loading, setLoading] = useState(false)
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

    // Form state
    const [roleName, setRoleName] = useState('')
    const [roleDescription, setRoleDescription] = useState('')
    const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

    const fetchRoles = () => {
        axios.get('/api/rbac/roles').then((res) => setRoles(res.data)).catch(() => { })
    }

    const fetchPermissions = () => {
        axios.get('/api/rbac/permissions').then((res) => setPermissions(res.data)).catch(() => { })
    }

    useEffect(() => {
        fetchRoles()
        fetchPermissions()
    }, [])

    const handleCreate = () => {
        setSelectedRole(null)
        setRoleName('')
        setRoleDescription('')
        setSelectedPermissions([])
        setDialogOpen(true)
    }

    const handleEdit = (role: any) => {
        setSelectedRole(role)
        setRoleName(role.name)
        setRoleDescription(role.description || '')
        setSelectedPermissions(role.permissions?.map((p: any) => p.key) || [])
        setDialogOpen(true)
    }

    const handleDelete = async (role: any) => {
        setConfirmAction({
            open: true,
            title: 'Delete Role',
            message: `Are you sure you want to delete the role "${role.name}"?`,
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/rbac/roles/${role.id}`)
                    notify('Role deleted successfully')
                    fetchRoles()
                } catch (err) {
                    console.error(err)
                    notify('Failed to delete role')
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        try {
            const payload = {
                name: roleName,
                description: roleDescription,
                permissions: selectedPermissions
            }

            if (selectedRole) {
                await axios.put(`/api/rbac/roles/${selectedRole.id}`, payload)
                notify('Role updated successfully')
            } else {
                await axios.post('/api/rbac/roles', payload)
                notify('Role created successfully')
            }

            setDialogOpen(false)
            fetchRoles()
        } catch (err: any) {
            console.error(err)
            notify(err?.response?.data?.message || 'Failed to save role')
        } finally {
            setLoading(false)
        }
    }

    const handlePermissionToggle = (permName: string, checked: boolean) => {
        if (checked) {
            setSelectedPermissions([...selectedPermissions, permName])
        } else {
            setSelectedPermissions(selectedPermissions.filter(p => p !== permName))
        }
    }

    // Group permissions by category
    const groupedPermissions = permissions.reduce((acc: any, perm: any) => {
        const category = perm.key.split('.')[0] || 'general'
        if (!acc[category]) acc[category] = []
        acc[category].push(perm)
        return acc
    }, {})

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography level="h2">Roles & Permissions</Typography>
                    <Typography level="body-md" color="neutral">Manage access control roles and permissions</Typography>
                </Box>
                <Button startDecorator={<AddIcon />} onClick={handleCreate}>
                    Create Role
                </Button>
            </Box>

            <Card variant="outlined">
                <CardContent>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography level="title-md">System Roles</Typography>
                        <Typography level="body-sm" color="neutral">
                            {roles.length} {roles.length === 1 ? 'role' : 'roles'}
                        </Typography>
                    </Box>
                    <Divider />
                    <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem' }}>
                        {roles.map((role) => (
                            <ListItem
                                key={role.id}
                                sx={{
                                    borderRadius: 'sm',
                                    mb: 0.5,
                                    '&:hover': {
                                        bgcolor: 'background.level1'
                                    }
                                }}
                                endAction={
                                    <Box sx={{ display: 'flex', gap: 1 }}>
                                        <IconButton size="sm" variant="soft" color="neutral" onClick={() => handleEdit(role)}>
                                            <EditIcon />
                                        </IconButton>
                                        <IconButton size="sm" variant="soft" color="danger" onClick={() => handleDelete(role)}>
                                            <DeleteIcon />
                                        </IconButton>
                                    </Box>
                                }
                            >
                                <Box sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 40,
                                    height: 40,
                                    borderRadius: 'sm',
                                    bgcolor: 'primary.softBg',
                                    mr: 2
                                }}>
                                    <SecurityIcon sx={{ color: 'primary.solidBg' }} />
                                </Box>
                                <ListItemContent>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Typography level="title-sm">{role.name}</Typography>
                                        {role.description && (
                                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                {role.description}
                                            </Typography>
                                        )}
                                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', mt: 0.5 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <VerifiedUserIcon sx={{ fontSize: 16, color: 'text.tertiary' }} />
                                                <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                    Permissions:
                                                </Typography>
                                            </Box>
                                            {role.permissions && role.permissions.length > 0 ? (
                                                <>
                                                    <Chip size="sm" variant="outlined" color="neutral">
                                                        {role.permissions.length} granted
                                                    </Chip>
                                                    {role.permissions.slice(0, 3).map((p: any) => (
                                                        <Chip key={p.id} size="sm" variant="soft" color="success">
                                                            {p.key}
                                                        </Chip>
                                                    ))}
                                                    {role.permissions.length > 3 && (
                                                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                            +{role.permissions.length - 3} more
                                                        </Typography>
                                                    )}
                                                </>
                                            ) : (
                                                <Typography level="body-xs" sx={{ color: 'text.tertiary', fontStyle: 'italic' }}>
                                                    No permissions assigned
                                                </Typography>
                                            )}
                                        </Box>
                                    </Box>
                                </ListItemContent>
                            </ListItem>
                        ))}
                        {roles.length === 0 && (
                            <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <SecurityIcon sx={{ fontSize: 48, color: 'neutral.400', mb: 1 }} />
                                    <Typography level="body-md" color="neutral">No roles found</Typography>
                                    <Typography level="body-sm" color="neutral" sx={{ mt: 0.5 }}>
                                        Create your first role to get started
                                    </Typography>
                                </Box>
                            </ListItem>
                        )}
                    </List>
                </CardContent>
            </Card>

            {/* Role Dialog */}
            <Modal open={dialogOpen} onClose={() => setDialogOpen(false)}>
                <ModalDialog sx={{ minWidth: 600, maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
                    <DialogTitle>{selectedRole ? 'Edit Role' : 'Create Role'}</DialogTitle>
                    <DialogContent>Configure role details and permissions.</DialogContent>
                    <form onSubmit={handleSubmit}>
                        <Stack spacing={2}>
                            <FormControl required>
                                <FormLabel>Role Name</FormLabel>
                                <Input
                                    autoFocus
                                    required
                                    value={roleName}
                                    onChange={(e) => setRoleName(e.target.value)}
                                    placeholder="e.g., admin, developer, viewer"
                                />
                            </FormControl>

                            <FormControl>
                                <FormLabel>Description</FormLabel>
                                <Input
                                    value={roleDescription}
                                    onChange={(e) => setRoleDescription(e.target.value)}
                                    placeholder="Brief description of this role"
                                />
                            </FormControl>

                            <FormControl>
                                <FormLabel>Permissions</FormLabel>
                                <Box sx={{
                                    maxHeight: 300,
                                    overflow: 'auto',
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: 'sm',
                                    p: 2
                                }}>
                                    {Object.keys(groupedPermissions).map(category => (
                                        <Box key={category} sx={{ mb: 2 }}>
                                            <Typography level="body-sm" sx={{ mb: 1, textTransform: 'capitalize', color: 'text.secondary' }}>
                                                {category}
                                            </Typography>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 1 }}>
                                                {groupedPermissions[category].map((perm: any) => (
                                                    <Checkbox
                                                        key={perm.id}
                                                        label={
                                                            <Box>
                                                                <Typography level="body-sm">{perm.key}</Typography>
                                                                {perm.description && (
                                                                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                                        {perm.description}
                                                                    </Typography>
                                                                )}
                                                            </Box>
                                                        }
                                                        checked={selectedPermissions.includes(perm.key)}
                                                        onChange={(e) => handlePermissionToggle(perm.key, e.target.checked)}
                                                    />
                                                ))}
                                            </Box>
                                        </Box>
                                    ))}
                                    {permissions.length === 0 && (
                                        <Typography level="body-sm" color="neutral" textAlign="center">
                                            No permissions available
                                        </Typography>
                                    )}
                                </Box>
                            </FormControl>

                            <Button type="submit" loading={loading}>
                                {selectedRole ? 'Save Changes' : 'Create Role'}
                            </Button>
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
        </Box>
    )
}
