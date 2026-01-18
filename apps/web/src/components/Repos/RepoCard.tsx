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

import * as React from 'react';
import { Card, CardContent, Typography, Box, Chip, IconButton, Dropdown, Menu, MenuButton, MenuItem, Divider, Tooltip } from '@mui/joy';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import VisibilityIcon from '@mui/icons-material/Visibility';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import SettingsIcon from '@mui/icons-material/Settings';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext'
import { getRepoAccessUrl } from '../../utils/repo'
import { canPerformOnRepo, hasGlobalPermission } from './repo-permissions'

interface RepoCardProps {
    repo: any;
    onDelete?: (id: string) => void;
}

export default function RepoCard({ repo, onDelete }: RepoCardProps) {
    const [liveStatus, setLiveStatus] = React.useState<any | null>(null);
    const [checking, setChecking] = React.useState(false);
    const handleCopyUrl = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!accessUrl) {
            // defensive: accessUrl should normally exist, but if routeName is missing
            // don't copy "undefined" and warn so we can trace problematic repos
            console.warn('RepoCard: copy requested but accessUrl is undefined for', repo)
            return;
        }

        navigator.clipboard.writeText(accessUrl);
    };

    const handleDelete = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (onDelete) onDelete(repo.id);
    }

    // Note: 'Open registry' action removed — registry host:port should be provided
    // by backend and used directly in UI, but opening external tabs from the
    // card was not desired per UX requirements.

    const { user } = useAuth();

    // compute friendly values
    const title = repo?.name || repo?.id || 'unknown';
    // prefer repo.name but fall back to id — always provide a route segment so details route receives something
    const routeName = repo?.name || repo?.id;
    // compute access URL: docker uses host:port if available, otherwise API repository endpoint
    // centralised helper for computing access URL (prefer API value, special-case docker)
    // explicitly pass the current origin so per-repo registries are constructed
    // as host:port when available (especially important for docker-managed repos)
    const accessUrl = getRepoAccessUrl(repo, typeof window !== 'undefined' ? window.location.origin : '');
    const upstreamStatus = (repo as any)?.upstreamStatus ?? null;
    const effectiveStatus = liveStatus ?? upstreamStatus;

    const canUpload = canPerformOnRepo(repo, 'repo.write') || hasGlobalPermission(user, 'repo.write');
    const canManage = canPerformOnRepo(repo, 'repo.manage') || hasGlobalPermission(user, 'repo.manage');
    // only show admin actions (upload, settings, delete) when the card is rendered
    // in a management context — we detect that by the presence of onDelete prop
    const inAdminContext = Boolean(onDelete);
    const [iconError, setIconError] = React.useState(false);

    // Trigger a live ping when the card mounts for proxy repos without upstreamStatus
    React.useEffect(() => {
        if (repo.type !== 'proxy' || upstreamStatus || typeof window === 'undefined' || process.env.NODE_ENV === 'test') {
            return;
        }

        let mounted = true;
        (async () => {
            setChecking(true);
            try {
                const axios = (await import('axios')).default;
                const res = await axios.get(`/api/repository/${encodeURIComponent(repo.id || repo.name)}/ping`);
                const s = res?.data?.status ?? (res?.data?.ok === false ? { ok: false, message: res?.data?.message ?? 'no status' } : null);
                if (mounted) setLiveStatus(s);
            } catch (err) {
                if (mounted) setLiveStatus({ ok: false, message: String(err) });
            } finally {
                if (mounted) setChecking(false);
            }
        })();
        return () => { mounted = false; };
    }, [repo.id, repo.type, upstreamStatus]);

    return (
        <Card
            variant="outlined"
            sx={{


                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    boxShadow: 'md',
                    transform: 'translateY(-2px)',
                    borderColor: 'primary.outlinedBorder',
                },
                cursor: 'pointer',
                textDecoration: 'none'
            }}
            component={Link}
            to={inAdminContext ? `/admin/repos/${encodeURIComponent(routeName)}` : `/repos/${encodeURIComponent(routeName)}`}
            state={{ repo }}
        >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                    <Box
                        sx={{
                            p: 1,
                            borderRadius: 'sm',
                            bgcolor: 'background.level1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                        }}
                    >
                        {(() => {
                            const managerKey = String(repo?.manager ?? '').toLowerCase();
                            const candidate = repo?.icon ? `/api${repo.icon}` : (managerKey ? `/api/plugins/${encodeURIComponent(managerKey)}/icon` : null);
                            if (candidate && !iconError) {
                                return (<img src={candidate} alt={`${repo.manager || 'repo'} icon`} style={{ width: 28, height: 28 }} onError={() => setIconError(true)} />);
                            }
                            return <FolderOutlinedIcon color="primary" />;
                        })()}
                    </Box>
                    <Box>
                        <Typography level="title-md">{title}</Typography>
                        <Typography level="body-xs">{repo.manager || 'generic'} • {repo.type || 'generic'}</Typography>
                        {accessUrl ? (
                            <Typography level="body-xs" sx={{ mt: 0.5, fontSize: 11, color: '#666', maxWidth: 230, whiteSpace: 'wrap', lineBreak: 'anywhere' }}>{accessUrl}</Typography>
                        ) : repo?.manager === 'docker' ? (
                            <Typography level="body-xs" sx={{ mt: 0.5, fontSize: 11, color: '#666' }}>
                                Docker repositories are served via a dedicated registry host:port (per-repo). No registry port configured / visible in this repo.
                            </Typography>
                        ) : null}
                    </Box>
                </Box>
                <Dropdown>
                    <MenuButton
                        data-testid="repo-card-menu"
                        slots={{ root: IconButton }}
                        slotProps={{ root: { variant: 'plain', color: 'neutral', size: 'sm' } }}
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}
                    >
                        <MoreVertIcon />
                    </MenuButton>
                    <Menu placement="bottom-end" size="sm">
                        <MenuItem component={Link} to={inAdminContext ? `/admin/repos/${encodeURIComponent(routeName)}` : `/repos/${encodeURIComponent(routeName)}`} state={{ repo }}>
                            <VisibilityIcon /> Browse
                        </MenuItem>
                        {accessUrl ? (
                            <MenuItem onClick={handleCopyUrl}>
                                <ContentCopyIcon /> Copy URL
                            </MenuItem>
                        ) : null}

                        {/* only show a dividing line if there will be items below it */}
                        {/* Only render the divider if there are actual admin actions below it
                            (Upload or Settings). Having Delete alone shouldn't cause a split
                            and would produce a trailing visual divider with no purpose. */}
                        {((canUpload && (String(repo?.manager || '').toLowerCase() !== 'docker') && String(repo?.type || '').toLowerCase() === 'hosted') ||
                            (inAdminContext && canManage)
                        ) ? <Divider /> : null}
                        {canUpload && (String(repo?.manager || '').toLowerCase() !== 'docker') && String(repo?.type || '').toLowerCase() === 'hosted' ? (
                            <MenuItem component={Link} to={inAdminContext ? `/admin/repos/${encodeURIComponent(routeName)}` : `/repos/${encodeURIComponent(routeName)}`} state={{ tab: 1, repo }}>
                                <CloudUploadIcon /> Upload
                            </MenuItem>
                        ) : null}
                        {/* Settings should navigate to the specific admin repo page and open the settings tab (tab index 2).
                            Previously it routed to `/admin/repos` (list) — this made Settings not behave like Upload which
                            navigates to the repo detail with a tab. */}
                        {inAdminContext && canManage ? (
                            <MenuItem component={Link} to={`/admin/repos/${encodeURIComponent(routeName)}`} state={{ tab: 2, repo }}>
                                <SettingsIcon /> Settings
                            </MenuItem>
                        ) : null}
                        {onDelete ? (
                            <MenuItem color="danger" onClick={handleDelete}>
                                <DeleteIcon /> Delete
                            </MenuItem>
                        ) : null}
                    </Menu>
                </Dropdown>
            </Box>
            <CardContent>
                <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    {/* type chip: hosted/proxy/group with different colors */}
                    {repo.type && (
                        <Chip
                            size="sm"
                            variant="soft"
                            color={
                                repo.type === 'hosted' ? 'success' : repo.type === 'proxy' ? 'warning' : 'primary'
                            }
                        >
                            {repo.type}
                        </Chip>
                    )}

                    <Chip size="sm" variant="soft" color={repo.manager === 'docker' ? 'primary' : 'neutral'}>
                        {repo.manager || 'generic'}
                    </Chip>
                    {repo.config?.docker?.version && (() => {
                        const rawVer = String(repo.config.docker.version || '').trim();
                        const displayVer = rawVer.match(/^v/i) ? rawVer : `v${rawVer}`;
                        return (<Chip size="sm" variant="outlined">{displayVer}</Chip>);
                    })()}
                    {repo.config?.nuget?.version && (() => {
                        const rawVer = String(repo.config.nuget.version || '').trim();
                        const displayVer = rawVer.match(/^v/i) ? rawVer : `v${rawVer}`;
                        return (<Chip size="sm" variant="outlined">{displayVer}</Chip>);
                    })()}
                    {/* show upstream ping status for proxy repos (use Tooltip to keep chip short) */}
                    {repo.type === 'proxy' && (
                        (() => {
                            if (checking && !effectiveStatus) return (<Chip size="sm" variant="outlined">Checking...</Chip>);
                            if (!effectiveStatus) return (<Chip size="sm" variant="outlined">Unchecked</Chip>);
                            const ts = effectiveStatus.ts ? new Date(effectiveStatus.ts).toLocaleString() : undefined;
                            const msg = effectiveStatus.message ? String(effectiveStatus.message) : '';
                            const tooltipText = effectiveStatus.ok
                                ? `Upstream OK${ts ? ` • ${ts}` : ''}`
                                : `Down${msg ? ` — ${msg}` : ''}${ts ? ` • ${ts}` : ''}`;

                            if (effectiveStatus.ok) {
                                return (
                                    <Tooltip title={tooltipText} placement="top">
                                        <Chip size="sm" variant="soft" color="success" startDecorator={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}>Upstream OK</Chip>
                                    </Tooltip>
                                );
                            }

                            return (
                                <Tooltip title={tooltipText} placement="top">
                                    <Chip size="sm" variant="soft" color="danger" startDecorator={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}>Upstream Down</Chip>
                                </Tooltip>
                            );
                        })()
                    )}
                </Box>
            </CardContent>
        </Card >
    );
}
