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
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Typography, Box, Tabs, TabList, Tab, TabPanel, CircularProgress, Chip, IconButton, Tooltip, Breadcrumbs, Link as JoyLink, Checkbox } from '@mui/joy'
import { FormControl, FormLabel, Input, Button, Select, Option } from '@mui/joy'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import StorageIcon from '@mui/icons-material/Storage'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import HomeIcon from '@mui/icons-material/Home'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import { useNotification } from '../components/NotificationSystem'
import axios from 'axios'
import RepoBrowse from '../components/Repos/RepoBrowse'
import RepoUpload from '../components/Repos/RepoUpload'
import RepositoryPermissions from '../components/Repos/RepositoryPermissions'
import { useAuth } from '../contexts/AuthContext'
import { getRepoAccessUrl } from '../utils/repo'
import { canPerformOnRepo, hasGlobalPermission } from '../components/Repos/repo-permissions'
import ConfirmationModal from '../components/ConfirmationModal'

export default function RepoDetails() {
    const { name } = useParams()
    // allow a repo to be passed via Link state from RepoCard so details show immediately
    // but always consult backend when loading the details route to get canonical data
    const location = useLocation();
    const [repo, setRepo] = useState<any>(location.state?.repo ?? null)
    const [loading, setLoading] = useState<boolean>(() => (location.state?.repo ? false : true))

    // DEBUG LOG
    useEffect(() => {
        console.log('[RepoDetails] Render state:', { name, hasRepo: !!repo, loading, locState: location.state });
    }, [name, repo, loading, location.state]);

    const [tab, setTab] = useState<number>(() => (location.state?.tab ? Number(location.state.tab) : 0))
    const [iconError, setIconError] = useState(false);
    const [liveStatus, setLiveStatus] = useState<any | null>(null);
    const [checking, setChecking] = useState(false);
    const { notify } = useNotification();
    const navigate = useNavigate();
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

    const handleDelete = async () => {
        if (!repo) return;
        const confirmName = repo.name || repo.id;
        setConfirmAction({
            open: true,
            title: 'Delete Repository',
            message: `Are you sure you want to delete repository "${confirmName}"? This action cannot be undone.`,
            color: 'danger',
            onConfirm: async () => {
                try {
                    await axios.delete(`/api/repository/${repo.id}`);
                    notify('Repository deleted');
                    navigate('/admin/repos');
                } catch (err) {
                    console.error(err);
                    notify('Failed to delete repository');
                }
                setConfirmAction(prev => ({ ...prev, open: false }));
            }
        });
    };

    useEffect(() => {
        if (!name) return;

        // always consult backend so details reflect canonical/current state
        // keep any existing repo in the UI immediately, show a spinner only if we don't have any data yet
        if (!repo) setLoading(true);

        axios
            .get(`/api/repository/${encodeURIComponent(name)}`)
            .then((res) => {
                // merge backend response into optimistic state but avoid overwriting
                // meaningful fields with placeholders or missing values
                const backend = res?.data ?? {};
                setRepo((prev: any) => {
                    if (!prev) return backend;
                    const merged: any = { ...prev };
                    for (const k of Object.keys(backend)) {
                        const val = (backend as any)[k];
                        if (val === undefined || val === null) continue;
                        if ((k === 'type' || k === 'manager') && String(val).trim() === '') continue;
                        merged[k] = val;
                    }
                    return merged;
                });
            })
            .catch((err) => {
                console.error(err);
            })
            .finally(() => setLoading(false));
    }, [name]);

    // Trigger a live ping when the details view mounts and there's no upstreamStatus yet for proxy repos
    useEffect(() => {
        if (!repo) return;
        if (repo.type !== 'proxy') return;
        if ((repo as any)?.upstreamStatus) return;
        if (typeof window === 'undefined') return;
        if (process.env.NODE_ENV === 'test') return;

        let mounted = true;
        (async () => {
            setChecking(true);
            try {
                const res = await axios.get(`/api/repository/${encodeURIComponent(repo.id || repo.name)}/ping`);
                const s = res?.data?.status ?? (res?.data?.ok === false ? { ok: false, message: res?.data?.message ?? 'no status' } : res?.data ?? null);
                if (mounted) setLiveStatus(s);
            } catch (err) {
                if (mounted) setLiveStatus({ ok: false, message: String(err) });
            } finally {
                if (mounted) setChecking(false);
            }
        })();

        return () => { mounted = false };
    }, [repo?.id, repo?.type]);

    const handleCopyUrl = () => {
        if (accessUrl) {
            navigator.clipboard.writeText(accessUrl);
            notify('URL copied to clipboard');
        }
    };

    if (loading) return <CircularProgress />
    if (!repo) return <Typography>Repository not found</Typography>

    const title = repo?.name || repo?.id;
    const accessUrl = getRepoAccessUrl(repo, window.location.origin);

    // permission checks
    const { user } = useAuth();
    const canUpload = canPerformOnRepo(repo, 'repo.write') || hasGlobalPermission(user, 'repo.write');
    // Upload should only be available when the repo is hosted and NOT managed by docker
    const showUpload = canUpload && String(repo?.type || '').toLowerCase() === 'hosted' && String(repo?.manager || '').toLowerCase() !== 'docker';
    const canManage = canPerformOnRepo(repo, 'repo.manage') || hasGlobalPermission(user, 'repo.manage');
    // only show settings when viewing under the admin route (/admin/repos/...),
    // ensure Browse route (/repos/...) never exposes Settings even for admin users
    const inAdminContext = location.pathname.startsWith('/admin/repos');


    return (
        <Box>
            <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} aria-label="breadcrumbs" sx={{ mb: 0 }}>
                <JoyLink color="neutral" href="/">
                    <HomeIcon />
                </JoyLink>
                <JoyLink color="neutral" href={inAdminContext ? "/admin/repos" : "/repos"}>
                    Repositories
                </JoyLink>
                <Typography>{title}</Typography>
            </Breadcrumbs>

            <Box sx={{ mb: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    {/* icon + title in single row */}
                    {(() => {
                        const managerKey = String(repo?.manager ?? '').toLowerCase();
                        const candidate = repo?.icon ? `/api${repo.icon}` : (managerKey ? `/api/plugins/${encodeURIComponent(managerKey)}/icon` : null);
                        if (candidate && !iconError) {
                            return (
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: 0.5, borderRadius: 'sm', bgcolor: 'background.level1' }}>
                                    <Box
                                        component="img"
                                        src={candidate}
                                        alt={repo.manager || 'repo'}
                                        sx={{ width: 28, height: 28, objectFit: 'contain' }}
                                        onError={() => setIconError(true)}
                                    />
                                </Box>
                            );
                        }

                        return (
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: 'sm', bgcolor: 'background.level1' }}>
                                <FolderOutlinedIcon color="primary" />
                            </Box>
                        );
                    })()}

                    <Typography level="h2"
                        sx={{ mr: 1 }}
                    >{title}</Typography>

                    {repo.type === 'proxy' && (
                        (() => {
                            const upstreamStatus = (repo as any)?.upstreamStatus ?? null;
                            const effectiveStatus = liveStatus ?? upstreamStatus;

                            if (checking && !effectiveStatus) return (<Chip size="sm" variant="outlined">Checking...</Chip>);
                            if (!effectiveStatus) return (<Chip size="sm" variant="outlined">Unchecked</Chip>);

                            const ts = effectiveStatus.ts ? new Date(effectiveStatus.ts).toLocaleString() : undefined;
                            const msg = effectiveStatus.message ? String(effectiveStatus.message) : '';
                            const tooltipText = effectiveStatus.ok
                                ? `Upstream OK${ts ? ` • ${ts}` : ''}`
                                : `Down${msg ? ` — ${msg}` : ''}${ts ? ` • ${ts}` : ''}`;

                            if (effectiveStatus.ok) {
                                return (
                                    <Tooltip title={tooltipText} placement="right">
                                        <Chip
                                            sx={{ marginTop: 1 }}
                                            size="sm" variant="soft" color="success" startDecorator={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}>Upstream OK</Chip>
                                    </Tooltip>
                                );
                            }

                            return (
                                <Tooltip title={tooltipText} placement="right">
                                    <Chip
                                        sx={{ marginTop: 1 }}
                                        size="sm" variant="soft" color="danger" startDecorator={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}>Upstream Down</Chip>
                                </Tooltip>
                            );
                        })()
                    )}

                    {inAdminContext && canManage && (
                        <Tooltip title="Delete Repository">
                            <IconButton
                                variant="outlined"
                                color="danger"
                                size="sm"
                                onClick={handleDelete}
                                sx={{ ml: 'auto' }}
                                aria-label="Delete Repository"
                            >
                                <DeleteIcon />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
                {/* removed duplicate icon+title row (merged above) */}

                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
                    <Chip
                        size="sm"
                        variant="soft"
                        color={
                            repo.type === 'hosted' ? 'success' : repo.type === 'proxy' ? 'warning' : 'primary'
                        }
                    >
                        {repo.type || 'unknown'}
                    </Chip>
                    {/* manager shown as a chip next to type, matching RepoCard layout */}
                    <Chip size="sm" variant="soft" color={repo.manager === 'docker' ? 'primary' : 'neutral'}>
                        {repo.manager || 'generic'}
                    </Chip>
                </Box>
                {/* Show upstream ping status for proxy repos (same behaviour as RepoCard) */}

                {accessUrl ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                        <Typography level="body-sm" color="neutral">{accessUrl}</Typography>
                        <Tooltip title="Copy URL">
                            <IconButton size="sm" variant="plain" onClick={handleCopyUrl}>
                                <ContentCopyIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Box>
                ) : repo?.manager === 'docker' ? (
                    <Typography level="body-sm" color="neutral" sx={{ mt: 1 }}>
                        Docker repositories are served via a dedicated registry host:port (per-repo). No registry port configured / visible in this repo.
                    </Typography>
                ) : null}
            </Box>

            <Tabs value={tab} onChange={(_, val) => setTab(val as number)} sx={{ bgcolor: 'transparent' }}>
                <TabList>
                    <Tab>Browse</Tab>
                    {showUpload ? <Tab>Upload</Tab> : null}
                    {inAdminContext && canManage ? <Tab>Permissions</Tab> : null}
                    {inAdminContext && canManage ? <Tab>Settings</Tab> : null}
                </TabList>

                <TabPanel value={0} sx={{ p: 0, pt: 2 }}>
                    {/* pass repo.id to internal API endpoints to avoid using name where id is required */}
                    <RepoBrowse repoId={repo.id} />
                </TabPanel>

                {showUpload ? (
                    <TabPanel value={1} sx={{ p: 0, pt: 2 }}>
                        <RepoUpload repoId={repo.id} />
                    </TabPanel>
                ) : null}

                {inAdminContext && canManage ? (
                    <TabPanel value={showUpload ? 2 : 1} sx={{ p: 0, pt: 2 }}>
                        <RepositoryPermissions repositoryId={repo.id} repositoryName={repo.name} />
                    </TabPanel>
                ) : null}

                {inAdminContext && canManage ? (
                    <TabPanel value={showUpload ? 3 : 2} sx={{ p: 0, pt: 2 }}>
                        {(() => {

                            return <RepoSettings repo={repo} setRepo={setRepo} confirmAction={confirmAction} setConfirmAction={setConfirmAction} />;
                        })()}
                    </TabPanel>
                ) : null}
            </Tabs>
            <ConfirmationModal
                open={confirmAction.open}
                onClose={() => setConfirmAction((prev) => ({ ...prev, open: false }))}
                onConfirm={confirmAction.onConfirm}
                title={confirmAction.title}
                message={confirmAction.message}
                color={confirmAction.color}
            />
        </Box>
    )
}

function RepoSettings({ repo, setRepo, confirmAction, setConfirmAction }: {
    repo: any;
    setRepo: (r: any) => void;
    confirmAction: {
        open: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        color: 'primary' | 'danger' | 'warning';
    };
    setConfirmAction: React.Dispatch<React.SetStateAction<{
        open: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        color: 'primary' | 'danger' | 'warning';
    }>>;
}) {


    const [configValues, setConfigValues] = useState<any>({
        type: repo?.type,
        ...(repo?.config || {})
    });
    const [authEnabled, setAuthEnabled] = useState<boolean>(repo?.config?.authEnabled ?? true);

    useEffect(() => {
        if (repo?.config?.authEnabled !== undefined) {
            setAuthEnabled(repo.config.authEnabled);
        }
    }, [repo]);

    const [pluginSchema, setPluginSchema] = useState<any>(null);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(true);
    const [availableRepos, setAvailableRepos] = useState<any[]>([]);
    const [availableStorageConfigs, setAvailableStorageConfigs] = useState<any[]>([]);
    const { notify } = useNotification();

    const manager = repo?.manager;
    const repoType = repo?.type;

    useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                // Fetch plugin schema
                if (manager) {
                    const res = await axios.get(`/api/plugins/${encodeURIComponent(manager)}/ping`);
                    const payload = res.data?.result ?? res.data ?? {};
                    const configSchema = payload?.capabilities?.configSchema ?? null;
                    if (mounted) setPluginSchema(configSchema);
                }

                // Fetch members if group repo
                if (repoType === 'group') {
                    const [reposRes, storageRes] = await Promise.all([
                        // axios.get(`/api/repository/${encodeURIComponent(repo.id || repo.name)}/members`),
                        axios.get('/api/repository'),
                        axios.get('/api/storage/configs')
                    ]);
                    if (mounted) {
                        // setMembers(membersRes.data?.members || []);
                        setAvailableRepos(Array.isArray(reposRes.data) ? reposRes.data : []);
                        setAvailableStorageConfigs(Array.isArray(storageRes.data) ? storageRes.data : []);
                    }
                } else {
                    // Fetch storage configs for non-group repos too
                    const storageRes = await axios.get('/api/storage/configs');
                    if (mounted) {
                        setAvailableStorageConfigs(Array.isArray(storageRes.data) ? storageRes.data : []);
                    }
                }
            } catch (err) {
                console.error('[RepoSettings] Error:', err);
            } finally {
                if (mounted) setLoading(false);
            }
        })();
        return () => { mounted = false };
    }, [repo.manager, repo.type, repo.id, repo.name]);

    const getNested = (obj: any, path: string[]): any => {
        return path.reduce((acc, key) => (acc && acc[key] !== undefined ? acc[key] : undefined), obj);
    };

    const setNested = (obj: any, path: string[], value: any): any => {
        if (path.length === 0) return value;
        const [head, ...rest] = path;
        return { ...obj, [head]: setNested(obj?.[head] || {}, rest, value) };
    };

    const updateConfigAtPath = (path: string[], value: any) => {
        setConfigValues((prev: any) => setNested(prev || {}, path, value));
    };

    const isFieldRelevantForRepoType = (path: string[], _schemaNode: any, currentRepoType: string | null) => {
        if (!currentRepoType) return true;
        const key = path[path.length - 1]?.toString().toLowerCase() ?? '';
        const proxyKeys = new Set(['proxyurl', 'proxy_url', 'upstream', 'registry', 'target', 'indexurl', 'index_url', 'upstreamurl']);
        if (proxyKeys.has(key)) return currentRepoType === 'proxy';
        if (key === 'members') return currentRepoType === 'group';
        return true;
    };

    const renderSchemaFields = (schema: any, path: string[] = []): any => {

        if (!schema) {
            return null;
        }

        if (schema.properties && !schema.type) {
            schema = { ...schema, type: 'object' };
        }

        if (schema.allOf && Array.isArray(schema.allOf)) {

            const baseProps = schema.properties || {};
            let conditionalProps: any = {};

            for (const condition of schema.allOf) {

                if (condition.if && condition.then) {
                    const ifProps = condition.if.properties || {};

                    let matches = true;

                    for (const [key, ifSchema] of Object.entries<any>(ifProps)) {
                        const checkPath = [...path, key];
                        const currentVal = getNested(configValues, checkPath);

                        if (ifSchema.const !== undefined && currentVal !== ifSchema.const) {
                            matches = false;

                            break;
                        }
                    }


                    if (matches && condition.then.properties) {
                        conditionalProps = { ...conditionalProps, ...condition.then.properties };
                    }
                } else {

                    if (condition.properties) {
                        conditionalProps = { ...conditionalProps, ...condition.properties };
                    }
                }
            }

            const allProps = { ...baseProps, ...conditionalProps };


            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.entries(allProps).map(([key, subschema]: any) => {

                        const newPath = [...path, key];
                        const isRelevant = isFieldRelevantForRepoType(newPath, subschema, repoType);

                        if (!isRelevant) return null;

                        if (subschema['x-conditional']) {
                            const { field, value } = subschema['x-conditional'];
                            const siblingPath = [...path, field];
                            const siblingValue = getNested(configValues, siblingPath);
                            if (Array.isArray(value)) {
                                if (!value.includes(siblingValue)) return null;
                            } else {
                                if (siblingValue !== value) return null;
                            }
                        }

                        if (key === 'preferredWriter' && repoType === 'group') {
                            const currentMembers = Array.isArray(configValues.members) ? configValues.members : [];
                            // Filter for hosted members only
                            const hostedMembers = currentMembers.filter((mid: string) => {
                                const r = availableRepos.find(ar => ar.id === mid || ar.name === mid);
                                return r && (r.type || '').toLowerCase() === 'hosted';
                            });

                            const currentValue = getNested(configValues, newPath);

                            return (
                                <div key={newPath.join('.')} style={{ paddingLeft: path.length > 1 ? 12 : 0 }}>
                                    <FormControl>
                                        <FormLabel>{subschema.title ?? key}</FormLabel>
                                        <Select
                                            value={currentValue ?? ''}
                                            onChange={(_, val) => updateConfigAtPath(newPath, val ?? '')}
                                            placeholder={hostedMembers.length ? "Select a writer" : "No hosted members available"}
                                        >
                                            {hostedMembers.map((mid: string) => {
                                                const r = availableRepos.find(ar => ar.id === mid || ar.name === mid);
                                                return (
                                                    <Option key={mid} value={mid}>
                                                        {r?.name || mid}
                                                    </Option>
                                                );
                                            })}
                                        </Select>
                                        {subschema.description && (
                                            <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{subschema.description}</Typography>
                                        )}
                                    </FormControl>
                                </div>
                            );
                        }

                        if (key === 'members') return null;

                        return (
                            <div key={newPath.join('.')} style={{ paddingLeft: path.length > 1 ? 12 : 0 }}>
                                {renderSchemaFields(subschema, newPath)}
                            </div>
                        );
                    })}
                </div>
            );
        }

        if (schema.type === 'object') {
            const props = schema.properties || {};
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.entries(props).map(([key, subschema]: any) => {
                        const newPath = [...path, key];
                        if (!isFieldRelevantForRepoType(newPath, subschema, repoType)) return null;

                        if (subschema['x-conditional']) {
                            const { field, value } = subschema['x-conditional'];
                            const siblingPath = [...path, field];
                            const siblingValue = getNested(configValues, siblingPath);
                            if (Array.isArray(value)) {
                                if (!value.includes(siblingValue)) return null;
                            } else {
                                if (siblingValue !== value) return null;
                            }
                        }

                        if (key === 'preferredWriter' && repoType === 'group') {
                            const currentMembers = Array.isArray(configValues.members) ? configValues.members : [];
                            // Filter for hosted members only
                            const hostedMembers = currentMembers.filter((mid: string) => {
                                const r = availableRepos.find(ar => ar.id === mid || ar.name === mid);
                                return r && (r.type || '').toLowerCase() === 'hosted';
                            });

                            const currentValue = getNested(configValues, newPath);

                            return (
                                <div key={newPath.join('.')} style={{ paddingLeft: path.length > 1 ? 12 : 0 }}>
                                    <FormControl>
                                        <FormLabel>{subschema.title ?? key}</FormLabel>
                                        <Select
                                            value={currentValue ?? ''}
                                            onChange={(_, val) => updateConfigAtPath(newPath, val ?? '')}
                                            placeholder={hostedMembers.length ? "Select a writer" : "No hosted members available"}
                                        >
                                            {hostedMembers.map((mid: string) => {
                                                const r = availableRepos.find(ar => ar.id === mid || ar.name === mid);
                                                return (
                                                    <Option key={mid} value={mid}>
                                                        {r?.name || mid}
                                                    </Option>
                                                );
                                            })}
                                        </Select>
                                        {subschema.description && (
                                            <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{subschema.description}</Typography>
                                        )}
                                    </FormControl>
                                </div>
                            );
                        }

                        if (key === 'members') return null;

                        return (
                            <div key={newPath.join('.')} style={{ paddingLeft: path.length > 1 ? 12 : 0 }}>
                                {renderSchemaFields(subschema, newPath)}
                            </div>
                        );
                    })}
                </div>
            );
        }

        const currentValue = getNested(configValues, path);

        if (schema.enum) {
            let enumOptions = Array.isArray(schema.enum) ? [...schema.enum] : [];
            let parentRequireAuth = false;
            if (path.length >= 2 && path[path.length - 1] === 'type' && path[path.length - 2] === 'auth') {
                const parentPath = [...path.slice(0, -2), 'requireAuth'];
                parentRequireAuth = Boolean(getNested(configValues, parentPath));
                if (parentRequireAuth) {
                    enumOptions = enumOptions.filter((e: any) => e !== 'none');
                }
            }

            const effectiveValue = currentValue ?? schema.default ?? (enumOptions.length > 0 ? enumOptions[0] : '');

            return (
                <FormControl key={path.join('.')}>
                    <FormLabel>{schema.title ?? path[path.length - 1]}</FormLabel>
                    <Select value={effectiveValue} onChange={(_, val) => updateConfigAtPath(path, val ?? '')}>
                        {enumOptions.map((e: any) => (
                            <Option key={e} value={e}>{String(e)}</Option>
                        ))}
                    </Select>
                    {schema.description && (
                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                    )}
                </FormControl>
            );
        }

        if (schema.type === 'string') {
            const inputType = schema.format === 'password' ? 'password' : 'text';
            return (
                <FormControl key={path.join('.')}>
                    <FormLabel>{schema.title ?? path[path.length - 1]}</FormLabel>
                    <Input
                        type={inputType}
                        value={currentValue ?? ''}
                        onChange={(e) => updateConfigAtPath(path, e.target.value)}
                        placeholder={schema.default ?? schema.description ?? ''}
                    />
                    {schema.description && (
                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                    )}
                </FormControl>
            );
        }

        if (schema.type === 'number' || schema.type === 'integer') {
            return (
                <FormControl key={path.join('.')}>
                    <FormLabel>{schema.title ?? path[path.length - 1]}</FormLabel>
                    <Input
                        type="number"
                        value={currentValue ?? 0}
                        onChange={(e) => updateConfigAtPath(path, Number(e.target.value))}
                        placeholder={schema.description ?? ''}
                    />
                    {schema.description && (
                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                    )}
                </FormControl>
            );
        }

        if (schema.type === 'boolean') {
            return (
                <FormControl key={path.join('.')}>
                    <Checkbox
                        checked={Boolean(currentValue)}
                        onChange={(e) => updateConfigAtPath(path, e.target.checked)}
                        label={schema.title ?? path[path.length - 1]}
                    />
                    {schema.description && (
                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                    )}
                </FormControl>
            );
        }

        return (
            <FormControl key={path.join('.')}>
                <FormLabel>{schema.title ?? path[path.length - 1]}</FormLabel>
                <Input value={JSON.stringify(currentValue ?? '')} onChange={(e) => updateConfigAtPath(path, e.target.value)} />
            </FormControl>
        );
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const id = repo?.id || repo?.name;
            // Remove 'type' from config before saving (it's not part of config, it's a repo property)
            const { type, ...configToSave } = configValues;
            const res = await axios.put(`/api/repository/${encodeURIComponent(id)}`, {
                config: {
                    ...configToSave,
                    authEnabled: authEnabled
                }
            });
            setRepo(res.data);
            notify('Repository settings updated');
        } catch (err: any) {
            console.error(err);
            notify(err?.response?.data?.message || 'Failed to update repository');
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <CircularProgress />;

    return (
        <Box sx={{ maxWidth: 800 }}>
            <Typography level="title-lg" sx={{ mb: 2 }}>Repository Settings</Typography>
            <Typography level="body-sm" color="neutral" sx={{ mb: 3 }}>
                Configure {repo?.name} repository
            </Typography>

            <Box sx={{ mb: 3 }}>
                <Typography level="title-md" sx={{ mb: 2 }}>Security</Typography>
                <FormControl>
                    <Checkbox
                        label="Authentication Required"
                        checked={authEnabled}
                        onChange={(e) => setAuthEnabled(e.target.checked)}
                    />
                    <Typography level="body-xs" sx={{ mt: 0.5, ml: 3 }}>
                        If disabled, this repository can be consumed (read) without authentication.
                    </Typography>
                </FormControl>
            </Box>

            <Box sx={{ mb: 3 }}>
                <Typography level="title-md" sx={{ mb: 2 }}>Storage</Typography>
                <FormControl>
                    <FormLabel>Storage Backend</FormLabel>
                    <Select
                        value={configValues.storageId ?? ''}
                        onChange={(_, val) => setConfigValues((prev: any) => ({ ...prev, storageId: val }))}
                        placeholder="Default (Filesystem)"
                    >
                        <Option value="">Default (Filesystem)</Option>
                        {availableStorageConfigs
                            .filter((c: any) => !c.usage || c.usage === 'repository')
                            .map((c: any) => (
                                <Option key={c.id} value={c.id}>
                                    {c.key} ({c.type}) {c.isDefault ? '(Default)' : ''}
                                </Option>
                            ))}
                    </Select>
                    <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>
                        Select where packages for this repository will be stored.
                    </Typography>
                    {(() => {
                        const currentStorageId = repo?.config?.storageId || null;
                        const newStorageId = configValues.storageId || null;
                        const hasChanged = currentStorageId !== newStorageId;

                        if (hasChanged) {
                            return (
                                <Box sx={{ mt: 2, p: 2, bgcolor: 'warning.softBg', borderRadius: 'sm' }}>
                                    <Typography level="body-sm" sx={{ mb: 1, fontWeight: 'bold' }}>
                                        ⚠️ Storage Location Changed
                                    </Typography>
                                    <Typography level="body-xs" sx={{ mb: 1 }}>
                                        Changing storage will not automatically move existing packages. You can:
                                    </Typography>
                                    <Box component="ul" sx={{ pl: 2, m: 0, fontSize: 'xs' }}>
                                        <li>Save and manually migrate files later</li>
                                        <li>Click "Migrate Now" to automatically copy all packages to the new location</li>
                                    </Box>
                                    <Button
                                        size="sm"
                                        variant="soft"
                                        color="warning"
                                        sx={{ mt: 1 }}
                                        onClick={() => {
                                            setConfirmAction({
                                                open: true,
                                                title: 'Migrate Storage',
                                                message: 'This will copy all packages to the new storage location. This may take some time. Continue?',
                                                color: 'warning',
                                                onConfirm: async () => {
                                                    try {
                                                        await axios.post(`/api/repository/${repo.id}/migrate-storage`, {
                                                            newStorageId: newStorageId
                                                        });
                                                        notify('Storage migration completed successfully');
                                                        // Refresh repo data
                                                        const res = await axios.get(`/api/repository/${repo.id}`);
                                                        setRepo(res.data);
                                                        setConfigValues({ type: res.data.type, ...(res.data.config || {}) });
                                                    } catch (err: any) {
                                                        notify(err?.response?.data?.message || 'Migration failed');
                                                    }
                                                    setConfirmAction(prev => ({ ...prev, open: false }));
                                                }
                                            });
                                        }}
                                    >
                                        Migrate Now
                                    </Button>
                                </Box>
                            );
                        }
                        return null;
                    })()}
                </FormControl>
            </Box>

            {pluginSchema ? (
                <Box sx={{ mb: 3 }}>
                    <Typography level="title-md" sx={{ mb: 2 }}>Configuration</Typography>
                    <Box>
                        {renderSchemaFields(pluginSchema, [])}
                    </Box>
                </Box>
            ) : (
                <Box sx={{ mb: 3 }}>
                    <Typography level="body-sm" color="neutral">
                        No configuration schema available for {manager || 'this manager'}
                    </Typography>
                </Box>
            )}

            {repoType === 'group' && (
                (() => {
                    const currentMembers: string[] = Array.isArray(configValues.members) ? configValues.members : [];
                    const memberSet = new Set(currentMembers);

                    // Filter repos: same manager, not group type, not already selected, and NOT SELF
                    const eligibleRepos = availableRepos.filter(r =>
                        r.manager === manager &&
                        r.type !== 'group' &&
                        !memberSet.has(r.id) &&
                        !memberSet.has(r.name) &&
                        r.id !== repo.id && r.name !== repo.name
                    );

                    const handleAddRepo = (repoId: string) => {
                        setConfigValues((prev: any) => {
                            const m = Array.isArray(prev?.members) ? [...prev.members] : [];
                            if (!m.includes(repoId)) m.push(repoId);
                            return { ...prev, members: m };
                        });
                    };

                    const handleRemoveRepo = (repoId: string) => {
                        setConfigValues((prev: any) => {
                            const m = Array.isArray(prev?.members) ? [...prev.members] : [];
                            const filtered = m.filter((id: string) => id !== repoId);
                            return { ...prev, members: filtered };
                        });
                    };

                    return (
                        <Box sx={{ mb: 3 }}>
                            <Typography level="title-md" sx={{ mb: 2 }}>Group Members</Typography>
                            <Typography level="body-sm" sx={{ mb: 2 }}>Select repositories to include in this group</Typography>

                            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                                {/* Available repos */}
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography level="body-sm" sx={{ mb: 1, fontWeight: 'bold' }}>Available Repositories</Typography>
                                    <Box sx={{
                                        border: '1px solid',
                                        borderColor: 'divider',
                                        borderRadius: 'sm',
                                        p: 1,
                                        minHeight: 200,
                                        maxHeight: 300,
                                        overflow: 'auto',
                                        bgcolor: 'background.level1'
                                    }}>
                                        {eligibleRepos.length === 0 ? (
                                            <Typography level="body-sm" color="neutral" sx={{ p: 2, textAlign: 'center' }}>
                                                No repositories available
                                            </Typography>
                                        ) : (
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                                {eligibleRepos.map((r) => (
                                                    <Box
                                                        key={r.id}
                                                        sx={{
                                                            display: 'flex',
                                                            justifyContent: 'space-between',
                                                            alignItems: 'center',
                                                            p: 1,
                                                            borderRadius: 'sm',
                                                            bgcolor: 'background.surface',
                                                            '&:hover': { bgcolor: 'background.level2' }
                                                        }}
                                                    >
                                                        <Box>
                                                            <Typography level="body-sm">{r.name}</Typography>
                                                            <Typography level="body-xs" color="neutral">{r.type}</Typography>
                                                        </Box>
                                                        <Button
                                                            size="sm"
                                                            variant="soft"
                                                            onClick={() => handleAddRepo(r.id)}
                                                        >
                                                            Add →
                                                        </Button>
                                                    </Box>
                                                ))}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>

                                {/* Selected repos */}
                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography level="body-sm" sx={{ mb: 1, fontWeight: 'bold' }}>Selected Members ({currentMembers.length})</Typography>
                                    <Box sx={{
                                        border: '1px solid',
                                        borderColor: 'primary.outlinedBorder',
                                        borderRadius: 'sm',
                                        p: 1,
                                        minHeight: 200,
                                        maxHeight: 300,
                                        overflow: 'auto',
                                        bgcolor: 'background.level1'
                                    }}>
                                        {currentMembers.length === 0 ? (
                                            <Typography level="body-sm" color="neutral" sx={{ p: 2, textAlign: 'center' }}>
                                                No members selected
                                            </Typography>
                                        ) : (
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                                {currentMembers.map((memberId) => {
                                                    const r = availableRepos.find(ar => ar.id === memberId || ar.name === memberId);
                                                    return (
                                                        <Box
                                                            key={memberId}
                                                            sx={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                p: 1,
                                                                borderRadius: 'sm',
                                                                bgcolor: 'background.surface',
                                                                '&:hover': { bgcolor: 'background.level2' }
                                                            }}
                                                        >
                                                            <Box>
                                                                <Typography level="body-sm">{r?.name || memberId}</Typography>
                                                                <Typography level="body-xs" color="neutral">{r?.type || 'unknown'}</Typography>
                                                            </Box>
                                                            <Button
                                                                size="sm"
                                                                variant="soft"
                                                                color="danger"
                                                                onClick={() => handleRemoveRepo(memberId)}
                                                            >
                                                                ← Remove
                                                            </Button>
                                                        </Box>
                                                    );
                                                })}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                    );
                })()
            )}

            <Box>
                <Button variant="solid" onClick={handleSave} loading={saving}>Save Changes</Button>
            </Box>


        </Box>
    );
}
