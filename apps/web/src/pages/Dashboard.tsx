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
import { Typography, Box, Card, CardContent, Grid, LinearProgress, Chip, Table } from '@mui/joy'
import CloudDownloadIcon from '@mui/icons-material/CloudDownload'
import CloudUploadIcon from '@mui/icons-material/CloudUpload'
import StorageIcon from '@mui/icons-material/Storage'
import InventoryIcon from '@mui/icons-material/Inventory'
import axios from 'axios'

export default function Dashboard() {
    const [metrics, setMetrics] = useState<any>({})
    const [repos, setRepos] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        Promise.all([
            axios.get('/api/monitor/metrics').catch(() => ({ data: {} })),
            axios.get('/api/repositories').catch(() => ({ data: [] }))
        ]).then(([metricsRes, reposRes]) => {
            setMetrics(metricsRes.data)
            setRepos(reposRes.data)
            setLoading(false)
        })
    }, [])

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]
    }

    const totalDownloads = metrics.totalDownloads || 0
    const totalUploads = metrics.totalUploads || 0
    const totalArtifacts = metrics.totalArtifacts || 0
    const totalStorage = metrics.totalStorage || 0

    // Proxy Metrics
    const proxyMetrics = metrics.proxyMetrics || { hits: 0, misses: 0, success: 0, failure: 0, errors: 0, durationTotal: 0 }
    const totalProxyReqs = proxyMetrics.success + proxyMetrics.failure + proxyMetrics.errors
    const cacheHitRate = (proxyMetrics.hits + proxyMetrics.misses) > 0
        ? Math.round((proxyMetrics.hits / (proxyMetrics.hits + proxyMetrics.misses)) * 100)
        : 0
    const avgLatency = totalProxyReqs > 0
        ? Math.round(proxyMetrics.durationTotal / totalProxyReqs)
        : 0


    return (
        <Box>
            <Box sx={{ mb: 3 }}>
                <Typography level="h2">Dashboard</Typography>
                <Typography level="body-md" color="neutral">System overview and metrics</Typography>
            </Box>

            {loading && <LinearProgress />}

            <Grid container spacing={2} sx={{ mb: 1 }}>
                <Grid xs={12} sm={6} md={3}>
                    <Card variant="outlined" >
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Box>
                                    <Typography level="body-sm" color="neutral">Downloads</Typography>
                                    <Typography level="h2">{totalDownloads.toLocaleString()}</Typography>
                                </Box>
                                <CloudDownloadIcon color="primary" sx={{ fontSize: 32 }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid xs={12} sm={6} md={3}>
                    <Card variant="outlined" >
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Box>
                                    <Typography level="body-sm" color="neutral">Uploads</Typography>
                                    <Typography level="h2">{totalUploads.toLocaleString()}</Typography>
                                </Box>
                                <CloudUploadIcon color="warning" sx={{ fontSize: 32 }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid xs={12} sm={6} md={3}>
                    <Card variant="outlined" >
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Box>
                                    <Typography level="body-sm" color="neutral">Artifacts</Typography>
                                    <Typography level="h2">{totalArtifacts.toLocaleString()}</Typography>
                                </Box>
                                <InventoryIcon color="success" sx={{ fontSize: 32 }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid xs={12} sm={6} md={3}>
                    <Card variant="outlined" >
                        <CardContent>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <Box>
                                    <Typography level="body-sm" color="neutral">Storage Used</Typography>
                                    <Typography level="h2">{formatBytes(totalStorage)}</Typography>
                                </Box>
                                <StorageIcon color="action" sx={{ fontSize: 32 }} />
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>


            <Grid container spacing={2} sx={{ mb: 4 }}>
                <Grid xs={12} sm={6} md={4}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography level="body-sm" color="neutral">Cache Hit Rate</Typography>
                            <Typography level="h2">{cacheHitRate}%</Typography>
                            <Typography level="body-xs">{proxyMetrics.hits} hits / {proxyMetrics.misses} misses</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid xs={12} sm={6} md={4}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography level="body-sm" color="neutral">Proxy Requests</Typography>
                            <Typography level="h2">{totalProxyReqs.toLocaleString()}</Typography>
                            <Typography level="body-xs">{proxyMetrics.success} success / {proxyMetrics.failure + proxyMetrics.errors} failed</Typography>
                        </CardContent>
                    </Card>
                </Grid>
                <Grid xs={12} sm={6} md={4}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography level="body-sm" color="neutral">Avg Latency</Typography>
                            <Typography level="h2">{avgLatency} ms</Typography>
                            <Typography level="body-xs">Per upstream request</Typography>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            <Grid container spacing={2} sx={{ mb: 3, mt: 2 }}>
                <Grid xs={12} md={6}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography level="title-md" sx={{ mb: 2 }}>Repository Statistics</Typography>
                            <Table size="sm">
                                <thead>
                                    <tr>
                                        <th>Repository</th>
                                        <th style={{ textAlign: 'right' }}>Artifacts</th>
                                        <th style={{ textAlign: 'right' }}>Storage</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {repos.filter(r => r.type !== 'group').slice(0, 10).map((repo) => {
                                        const artifactCount = parseInt(metrics.artifactsByRepo?.[repo.id]) || 0
                                        const storage = parseInt(metrics.storageByRepo?.[repo.id]?.size) || 0
                                        return (
                                            <tr key={repo.id}>
                                                <td>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography level="body-sm">{repo.name}</Typography>
                                                        <Chip size="sm" variant="soft" color={repo.manager === 'docker' ? 'primary' : 'neutral'}>
                                                            {repo.type}
                                                        </Chip>
                                                    </Box>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <Typography level="body-sm">{artifactCount.toLocaleString()}</Typography>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <Typography level="body-sm">{formatBytes(storage)}</Typography>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {repos.filter(r => r.type !== 'group').length === 0 && (
                                        <tr>
                                            <td colSpan={3}>
                                                <Typography level="body-sm" color="neutral" textAlign="center" sx={{ py: 2 }}>
                                                    No repositories yet
                                                </Typography>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </Table>
                        </CardContent>
                    </Card>
                </Grid>

                <Grid xs={12} md={6}>
                    <Card variant="outlined" sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography level="title-md" sx={{ mb: 2 }}>Activity by Repository</Typography>
                            <Table size="sm">
                                <thead>
                                    <tr>
                                        <th>Repository</th>
                                        <th style={{ textAlign: 'right' }}>Downloads</th>
                                        <th style={{ textAlign: 'right' }}>Uploads</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {repos.slice(0, 10).map((repo) => {
                                        const downloads = parseInt(metrics.downloadsByRepo?.[repo.id]) || 0
                                        const uploads = parseInt(metrics.uploadsByRepo?.[repo.id]) || 0
                                        if (downloads === 0 && uploads === 0) return null
                                        return (
                                            <tr key={repo.id}>
                                                <td>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography level="body-sm">{repo.name}</Typography>
                                                        <Chip size="sm" variant="soft" color={repo.manager === 'docker' ? 'primary' : 'neutral'}>
                                                            {repo.type}
                                                        </Chip>
                                                    </Box>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <Typography level="body-sm">{downloads.toLocaleString()}</Typography>
                                                </td>
                                                <td style={{ textAlign: 'right' }}>
                                                    <Typography level="body-sm">{uploads.toLocaleString()}</Typography>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {repos.every(r => (metrics.downloadsByRepo?.[r.id] || 0) === 0 && (metrics.uploadsByRepo?.[r.id] || 0) === 0) && (
                                        <tr>
                                            <td colSpan={3}>
                                                <Typography level="body-sm" color="neutral" textAlign="center" sx={{ py: 2 }}>
                                                    No activity yet
                                                </Typography>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </Table>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            <Card variant="outlined" sx={{ marginTop: 5 }}>
                <CardContent>
                    <Typography level="title-md" sx={{ mb: 2, }}>Recent Artifacts</Typography>
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        {(metrics.recentArtifacts || []).map((artifact: any) => (
                            <Box
                                key={artifact.id}
                                sx={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    p: 1,
                                    borderRadius: 'sm',
                                    '&:hover': { bgcolor: 'background.level1' }
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                    <InventoryIcon />
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
                                            <Typography level="title-sm" sx={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                maxWidth: '300px'
                                            }}>
                                                {artifact.name || 'Unknown'}
                                            </Typography>
                                            {artifact.version && (
                                                <Typography level="body-xs" color="neutral" sx={{ whiteSpace: 'nowrap' }}>
                                                    v{artifact.version}
                                                </Typography>
                                            )}
                                        </Box>
                                        <Typography level="body-xs" color="neutral">
                                            {artifact.repository?.name || 'N/A'} • {formatBytes(artifact.size)}
                                        </Typography>
                                    </Box>
                                </Box>
                                <Box sx={{ textAlign: 'right' }}>
                                    <Chip size="sm" variant="soft" color={artifact.repository?.manager === 'docker' ? 'primary' : 'neutral'}>
                                        {artifact.repository?.manager || 'generic'}
                                    </Chip>
                                    <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>
                                        {artifact.createdAt ? new Date(artifact.createdAt).toLocaleDateString() : 'N/A'}
                                    </Typography>
                                </Box>
                            </Box>
                        ))}
                        {(!metrics.recentArtifacts || metrics.recentArtifacts.length === 0) && (
                            <Typography level="body-sm" color="neutral" textAlign="center" sx={{ py: 2 }}>
                                No artifacts yet
                            </Typography>
                        )}
                    </Box>
                </CardContent>
            </Card>
        </Box>
    )
}
