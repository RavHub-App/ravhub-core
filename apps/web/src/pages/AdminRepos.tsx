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

import { useEffect, useState } from 'react'
import { Typography, Box, Button, Input } from '@mui/joy'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import axios from 'axios'
import { useNavigate } from 'react-router-dom'
import RepoCard from '../components/Repos/RepoCard'
import { useAuth } from '../contexts/AuthContext'
import { useNotification } from '../components/NotificationSystem'
import ConfirmationModal from '../components/ConfirmationModal'

export default function AdminRepos() {
    const { notify } = useNotification()
    const [repos, setRepos] = useState<any[]>([])
    const [search, setSearch] = useState('')
    const [confirmDelete, setConfirmDelete] = useState<{ open: boolean, id: string, name: string }>({
        open: false,
        id: '',
        name: ''
    })
    const navigate = useNavigate()

    const fetchRepos = () => {
        axios.get('/api/repositories').then((res) => setRepos(res.data)).catch(() => { })
    }

    // Poll repositories periodically so UI reflects upstream ping status updates
    useEffect(() => {
        fetchRepos();

        const env = (import.meta as any)?.env ?? {};
        const pollMs = parseInt(env.VITE_REPOS_POLL_INTERVAL_MS ?? '', 10) || 9900; // default 15s

        const id = setInterval(() => {
            fetchRepos();
        }, Math.max(2000, pollMs));

        return () => clearInterval(id);
    }, [])

    const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))

    const handleDelete = (id: string) => {
        const repo = repos.find(r => r.id === id);
        const name = repo?.name || id;
        setConfirmDelete({ open: true, id, name });
    }

    const onConfirmDelete = async () => {
        const { id } = confirmDelete;
        try {
            await axios.delete(`/api/repository/${id}`)
            fetchRepos()
            notify('Repository deleted successfully')
        } catch (err) {
            console.error(err)
            notify('Failed to delete repository')
        } finally {
            setConfirmDelete({ open: false, id: '', name: '' })
        }
    }

    const { user } = useAuth();

    const canManage = Boolean(
        user && (
            user.permissions?.includes('repo.manage') ||
            user.permissions?.includes('*') ||
            user.roles?.includes('admin') ||
            user.roles?.includes('superadmin')
        )
    );

    if (!canManage) {
        return (
            <Box>
                <Typography level="h2">Repository Management</Typography>
                <Typography level="body-md" color="neutral">You do not have permission to manage repositories.</Typography>
            </Box>
        )
    }

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography level="h2">Repository Management</Typography>
                    <Typography level="body-md" color="neutral">Create, update and delete repositories</Typography>
                </Box>
                <Button startDecorator={<AddIcon />} onClick={() => navigate('/admin/repos/create')}>
                    Create Repository
                </Button>
            </Box>

            <Box sx={{ mb: 3 }}>
                <Input
                    startDecorator={<SearchIcon />}
                    placeholder="Filter repositories..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    sx={{ maxWidth: 400 }}
                />
            </Box>

            {filteredRepos.length > 0 ? (
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fit, minmax(280px, 1fr))' },
                        gap: 2,
                    }}
                >
                    {filteredRepos.map((r) => (
                        <RepoCard key={r.id} repo={r} onDelete={handleDelete} />
                    ))}
                </Box>
            ) : (
                <Box sx={{ width: '100%', textAlign: 'center', py: 8 }}>
                    <Typography level="title-lg" color="neutral">No repositories found</Typography>
                </Box>
            )}

            <ConfirmationModal
                open={confirmDelete.open}
                onClose={() => setConfirmDelete({ ...confirmDelete, open: false })}
                onConfirm={onConfirmDelete}
                title="Delete Repository"
                message={`Are you sure you want to delete ${confirmDelete.name}? This action cannot be undone.`}
                color="danger"
                confirmText="Delete"
            />
        </Box>
    )
}
