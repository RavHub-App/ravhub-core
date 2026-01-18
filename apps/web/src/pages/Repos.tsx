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
import { Typography, Box, Input } from '@mui/joy'
import SearchIcon from '@mui/icons-material/Search'
import axios from 'axios'
import RepoCard from '../components/Repos/RepoCard'

export default function Repos() {
    const [repos, setRepos] = useState<any[]>([])
    const [search, setSearch] = useState('')
    // read-only page

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
        }, Math.max(2000, pollMs)); // minimum 2s to avoid accidental busy loops

        return () => clearInterval(id);
    }, [])

    const filteredRepos = repos.filter(r => r.name.toLowerCase().includes(search.toLowerCase()))


    // This page is meant for browsing repositories (read-only). Management (create/edit/delete)
    // happens under Administration -> Repository Management (/admin/repos).

    return (
        <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
                <Box>
                    <Typography level="h2">Repositories</Typography>
                    <Typography level="body-md" color="neutral">Browse artifact repositories</Typography>
                </Box>
                <></>
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
                        <RepoCard key={r.id} repo={r} />
                    ))}
                </Box>
            ) : (
                <Box sx={{ width: '100%', textAlign: 'center', py: 8 }}>
                    <Typography level="title-lg" color="neutral">No repositories found</Typography>
                </Box>
            )}

            {/* Browse-only page, no create modal here */}
        </Box>
    )
}
