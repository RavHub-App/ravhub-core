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

import React from 'react';
import { Typography, Box, Stack, FormControl, FormLabel, Input, Select, Option, Button, Checkbox, Breadcrumbs, Link, Divider, Grid } from '@mui/joy';
import StorageIcon from '@mui/icons-material/Storage';
import HomeIcon from '@mui/icons-material/Home';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import { useNotification } from '../components/NotificationSystem';


export default function CreateRepository() {
    const navigate = useNavigate();
    const { notify } = useNotification();

    const [name, setName] = React.useState('');
    const [manager, setManager] = React.useState<string | null>(null);
    const [repoType, setRepoType] = React.useState<string | null>(null);
    const [authEnabled, setAuthEnabled] = React.useState(true);
    const [loading, setLoading] = React.useState(false);

    const [availableManagers, setAvailableManagers] = React.useState<any[]>([]);
    const [availableRepoTypes, setAvailableRepoTypes] = React.useState<string[]>([]);
    const [pluginConfigSchema, setPluginConfigSchema] = React.useState<any | null>(null);
    const [configValues, setConfigValues] = React.useState<any>({});
    const [pluginInfo, setPluginInfo] = React.useState<string | null>(null);
    const [availableRepos, setAvailableRepos] = React.useState<any[]>([]);
    const [availableStorageConfigs, setAvailableStorageConfigs] = React.useState<any[]>([]);
    const [selectedStorageId, setSelectedStorageId] = React.useState<string | null>(null);

    React.useEffect(() => {
        let mounted = true;
        (async () => {
            try {
                const [pluginsRes, reposRes, storageRes] = await Promise.all([
                    axios.get('/api/plugins'),
                    axios.get('/api/repository'),
                    axios.get('/api/storage/configs')
                ]);
                const plugins: any[] = Array.isArray(pluginsRes.data) ? pluginsRes.data : [];
                const repos: any[] = Array.isArray(reposRes.data) ? reposRes.data : [];
                const storage: any[] = Array.isArray(storageRes.data) ? storageRes.data : [];
                if (mounted) {
                    setAvailableManagers(plugins || []);
                    setAvailableRepos(repos || []);
                    setAvailableStorageConfigs(storage || []);
                    if (plugins.length > 0) setManager(plugins[0].key);
                }
            } catch (e) {
                console.error(e);
            }
        })();
        return () => { mounted = false; };
    }, []);

    React.useEffect(() => {
        if (!manager) {
            setAvailableRepoTypes([]);
            setPluginConfigSchema(null);
            setRepoType(null);
            return;
        }
        let mounted = true;
        (async () => {
            try {
                const res = await axios.get(`/api/plugins/${encodeURIComponent(manager)}/ping`);
                const payload = res.data?.result ?? res.data ?? {};
                const repoTypes: string[] = payload?.capabilities?.repoTypes ?? [];
                const configSchema = payload?.capabilities?.configSchema ?? null;
                const info = payload?.info ?? payload?.message ?? null;
                if (mounted) {
                    setAvailableRepoTypes(repoTypes);
                    setPluginConfigSchema(configSchema);
                    setPluginInfo(info);
                    const defaultType = repoTypes.length ? repoTypes[0] : null;
                    setRepoType(defaultType);
                    if (configSchema) {
                        setConfigValues(generateDefaultsFromSchema(configSchema));
                    } else {
                        setConfigValues({});
                    }
                }
            } catch (err) {
                if (mounted) {
                    setAvailableRepoTypes([]);
                    setPluginConfigSchema(null);
                    setPluginInfo(null);
                    setRepoType(null);
                }
            }
        })();
        return () => { mounted = false; };
    }, [manager]);

    React.useEffect(() => {
        if (!repoType) return;
        setConfigValues((prev: any) => {
            const next = { ...(prev || {}) };
            if (repoType === 'group') {
                if (!Array.isArray(next.members)) next.members = [];
            }
            if (repoType === 'proxy') {
                if (!next.proxyUrl && !next.target && !next.registry && !next.upstream && !next.indexUrl) next.proxyUrl = '';
            }
            return next;
        });
    }, [repoType]);

    // Keep auth defaults in sync with requireAuth toggle so UI doesn't show 'none' when requireAuth=true
    React.useEffect(() => {
        try {
            const pathsToCheck = [
                { prefix: ['docker'], authPath: ['docker', 'auth'] },
                { prefix: ['nuget'], authPath: ['nuget', 'auth'] },
                { prefix: [], authPath: ['auth'] }
            ];

            pathsToCheck.forEach(({ prefix, authPath }) => {
                // Check if this path exists in the current config structure
                // We check if requireAuth exists at this prefix
                const requireAuthPath = [...prefix, 'requireAuth'];
                const requireAuthVal = getNested(configValues, requireAuthPath);

                if (requireAuthVal !== undefined) {
                    const requireAuth = requireAuthVal === true;

                    if (requireAuth) {
                        const authType = getNested(configValues, [...authPath, 'type']);
                        if (!authType || authType === 'none') {
                            setConfigValues((prev: any) => setNested(prev || {}, [...authPath, 'type'], 'basic'));
                        }
                    } else {
                        // If requireAuth is false, ensure auth is applied as none (transparent to user)
                        const authVal = getNested(configValues, authPath);
                        if (!authVal || authVal?.type !== 'none') {
                            setConfigValues((prev: any) => setNested(prev || {}, authPath, { type: 'none' }));
                        }
                    }
                }
            });
        } catch (e) { }
    }, [configValues, manager]);

    const friendlyManager = (m: any) => m?.name || m?.key || m;

    const friendly = (t: string) => {
        const map: Record<string, string> = {
            docker: 'Docker',
            nuget: 'NuGet',
            npm: 'NPM',
            maven: 'Maven',
            composer: 'Composer',
            pypi: 'PyPI',
            generic: 'Generic',
        };
        return map[t] ?? t;
    };

    const getNested = (obj: any, path: string[]) => {
        return path.reduce((acc, p) => (acc && acc[p] !== undefined ? acc[p] : undefined), obj);
    };

    const setNested = (obj: any, path: string[], value: any) => {
        if (!path.length) return value;
        const [first, ...rest] = path;
        const next = { ...(obj || {}) };
        next[first] = setNested(next[first], rest, value);
        return next;
    };

    const generateDefaultsFromSchema = (schema: any): any => {
        if (!schema) return {};

        // If schema contains allOf, merge defaults from each branch (useful when
        // configSchema is conditional with multiple 'then' branches). We merge
        // recursively so defaults like cacheRetentionDays present inside a
        // branch are included in the final defaults object.
        if (schema.allOf && Array.isArray(schema.allOf)) {
            const merged: any = {};
            for (const item of schema.allOf) {
                const node = item.then ?? item;
                const defaults = generateDefaultsFromSchema(node);
                // shallow merge with existing values preserved
                for (const [k, v] of Object.entries<any>(defaults || {})) {
                    if (merged[k] === undefined) merged[k] = v;
                    else if (typeof merged[k] === 'object' && typeof v === 'object') {
                        // deep merge objects
                        merged[k] = { ...v, ...merged[k] };
                    }
                }
            }
            return merged;
        }

        if (schema.type === 'object' || schema.properties) {
            const out: any = {};
            const props = schema.properties || {};
            for (const [k, v] of Object.entries<any>(props)) {
                const defaultVal = generateDefaultsFromSchema(v);
                if (defaultVal !== '') {
                    out[k] = defaultVal;
                }
            }
            return out;
        }
        if (schema.type === 'array') return [];
        if (schema.default !== undefined) return schema.default;
        if (schema.type === 'string') return '';
        if (schema.enum && schema.enum.length) return schema.default ?? schema.enum[0];
        if (schema.type === 'boolean') return false;
        if (schema.type === 'number' || schema.type === 'integer') return schema.default ?? 0;
        return '';
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

    const resolveSchemaForRepoType = (schema: any, currentRepoType: string | null): any => {
        if (!schema) return null;
        if (schema.allOf && Array.isArray(schema.allOf)) {
            for (const condition of schema.allOf) {
                if (condition.if && condition.then) {
                    const ifProps = condition.if.properties || {};
                    if (ifProps.type && ifProps.type.const === currentRepoType) {
                        return condition.then;
                    }
                }
            }
        }
        return schema;
    };

    const renderSchemaFields = (schema: any, path: string[] = []) => {
        if (!schema) return null;

        if (schema.properties && !schema.type && !schema.allOf) {
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
                }
            }

            const allProps = { ...baseProps, ...conditionalProps };

            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {Object.entries(allProps).map(([key, subschema]: any) => {
                        const newPath = [...path, key];
                        if (!isFieldRelevantForRepoType(newPath, subschema, repoType)) return null;

                        // Handle x-conditional
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

                        // Skip members as it is handled specially
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

                        // Handle x-conditional
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

                        // Skip members as it is handled specially
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
            // If we're rendering an auth.type field, hide 'none' option when the parent requireAuth is true
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
                <FormControl key={path.join('.')} data-testid={`field-${path.join('-')}`}>
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
            const lastKey = path[path.length - 1];
            // Handle cache retention fields (both old cacheTtlSeconds and new cacheRetentionDays)
            const isCacheRetention = manager === 'docker' && (repoType === 'proxy' || repoType === 'group') &&
                (lastKey === 'cacheTtlSeconds' || lastKey === 'cacheRetentionDays');

            if (isCacheRetention) {
                // If it's the old cacheTtlSeconds field, convert seconds to days
                // If it's the new cacheRetentionDays field, use directly
                const isDaysField = lastKey === 'cacheRetentionDays';
                const displayValue = isDaysField
                    ? Number(currentValue ?? 0)
                    : Math.max(0, Math.round(Number(currentValue ?? 0) / 86400));

                return (
                    <FormControl key={path.join('.')}>
                        <FormLabel>{schema.title || 'Cache retention policy (days)'}</FormLabel>
                        <Input
                            type="number"
                            value={displayValue}
                            onChange={(e) => {
                                const days = Math.max(0, Number(e.target.value || 0));
                                // Store as days if new field, as seconds if old field
                                const valueToStore = isDaysField ? days : days * 86400;
                                updateConfigAtPath(path, valueToStore);
                            }}
                            slotProps={{
                                input: {
                                    min: 0,
                                    step: 1
                                }
                            }}
                        />
                        {schema.description && (
                            <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                        )}

                        {/* helper text comes from schema.description (metadata from backend) */}
                    </FormControl>
                );
            }
            return (
                <FormControl key={path.join('.')}>
                    <FormLabel>{schema.title ?? path[path.length - 1]}</FormLabel>
                    <Input type="number" value={currentValue ?? 0} onChange={(e) => updateConfigAtPath(path, Number(e.target.value))} placeholder={schema.description ?? ''} />
                    {schema.description && (
                        <Typography level="body-xs" color="neutral" sx={{ mt: 0.5 }}>{schema.description}</Typography>
                    )}

                    {/* helper text comes from schema.description (metadata from backend) */}
                </FormControl>
            );
        }

        if (schema.type === 'boolean') {
            return (
                <FormControl key={path.join('.')}>
                    {/* Render a single-line checkbox+label for clarity */}
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

    const renderRepoTypeSpecial = () => {
        if (repoType === 'group') {
            const members: string[] = Array.isArray(configValues.members) ? configValues.members : [];
            const memberSet = new Set(members);

            // Filter repos: same manager, not group type, not already selected
            const eligibleRepos = availableRepos.filter(r =>
                r.manager === manager &&
                r.type !== 'group' &&
                !memberSet.has(r.id) &&
                !memberSet.has(r.name)
            );



            const handleAddRepo = (repoId: string) => {
                setConfigValues((prev: any) => {
                    const m = Array.isArray(prev?.members) ? [...prev.members] : [];
                    if (!m.includes(repoId)) m.push(repoId);
                    return { ...(prev || {}), members: m };
                });
            };

            const handleRemoveRepo = (repoId: string) => {
                setConfigValues((prev: any) => {
                    const m = Array.isArray(prev?.members) ? [...prev.members] : [];
                    const filtered = m.filter((id: string) => id !== repoId);
                    return { ...(prev || {}), members: filtered };
                });
            };

            return (
                <FormControl>
                    <FormLabel>Group Members</FormLabel>
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
                                    <Stack spacing={0.5}>
                                        {eligibleRepos.map((repo) => (
                                            <Box
                                                key={repo.id}
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
                                                    <Typography level="body-sm">{repo.name}</Typography>
                                                    <Typography level="body-xs" color="neutral">{repo.type}</Typography>
                                                </Box>
                                                <Button
                                                    size="sm"
                                                    variant="soft"
                                                    onClick={() => handleAddRepo(repo.id)}
                                                >
                                                    Add →
                                                </Button>
                                            </Box>
                                        ))}
                                    </Stack>
                                )}
                            </Box>
                        </Box>

                        {/* Selected repos */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography level="body-sm" sx={{ mb: 1, fontWeight: 'bold' }}>Selected Members ({members.length})</Typography>
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
                                {members.length === 0 ? (
                                    <Typography level="body-sm" color="neutral" sx={{ p: 2, textAlign: 'center' }}>
                                        No members selected
                                    </Typography>
                                ) : (
                                    <Stack spacing={0.5}>
                                        {members.map((memberId) => {
                                            const repo = availableRepos.find(r => r.id === memberId || r.name === memberId);
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
                                                        <Typography level="body-sm">{repo?.name || memberId}</Typography>
                                                        <Typography level="body-xs" color="neutral">{repo?.type || 'unknown'}</Typography>
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
                                    </Stack>
                                )}
                            </Box>
                        </Box>
                    </Box>
                </FormControl>
            );
        }

        if (repoType === 'proxy') {
            const possible = ['target', 'registry', 'upstream', 'indexUrl', 'proxyUrl'];
            const schemaHasUpstream = (schema: any): boolean => {
                if (!schema || typeof schema !== 'object') return false;
                if (schema.properties) {
                    for (const k of Object.keys(schema.properties)) {
                        if (possible.includes(k)) return true;
                        if (schemaHasUpstream(schema.properties[k])) return true;
                    }
                }
                return false;
            };

            const _resolved = resolveSchemaForRepoType(pluginConfigSchema, repoType);
            const hasUpstream = schemaHasUpstream(_resolved);

            if (hasUpstream) {
                return null;
            }

            const cur = configValues?.['proxyUrl'] ?? '';
            return (
                <FormControl>
                    <FormLabel>Proxy URL (fetch source — packages are cached in storage)</FormLabel>
                    <Input value={cur} onChange={(e) => updateConfigAtPath(['proxyUrl'], e.target.value)} placeholder="e.g. https://registry.example.com — packages fetched are cached in repository storage and not forwarded" />
                </FormControl>
            );
        }

        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            // HTML5 validation usually catches this, but for robustness (and tests)
            return;
        }
        setLoading(true);
        try {
            let payloadConfig = configValues || {};
            if ((repoType || '').toString().toLowerCase() === 'proxy') {
                const hasUpstream = (obj: any): boolean => {
                    if (!obj || typeof obj !== 'object') return false;
                    for (const k of Object.keys(obj)) {
                        if (['target', 'registry', 'upstream', 'indexUrl', 'proxyUrl'].includes(k) && obj[k] && String(obj[k]).trim()) return true;
                        if (typeof obj[k] === 'object') {
                            if (hasUpstream(obj[k])) return true;
                        }
                    }
                    return false;
                };

                if (!hasUpstream(configValues)) {
                    const findDefault = (schema: any, path: string[] = []): { path: string[]; value: any } | null => {
                        if (!schema || typeof schema !== 'object') return null;
                        const props = schema.properties || {};
                        for (const [k, v] of Object.entries<any>(props)) {
                            const key = k.toString();
                            const proxyCandidates = ['proxyUrl', 'proxyurl', 'target', 'registry', 'upstream', 'indexUrl', 'indexurl', 'index_url', 'upstreamurl'];
                            if (proxyCandidates.includes(key) && v?.default) {
                                return { path: [...path, key], value: v.default };
                            }
                            const nested = findDefault(v, [...path, key]);
                            if (nested) return nested;
                        }
                        return null;
                    };

                    const found = findDefault(pluginConfigSchema);
                    if (found && found.value && String(found.value).trim()) {
                        const finalConfig = setNested(configValues || {}, found.path, found.value);
                        setConfigValues(finalConfig);
                        payloadConfig = finalConfig;
                    } else {
                        notify('Proxy repositories require a proxy URL (fill the proxy URL/target field)');
                        setLoading(false);
                        return;
                    }
                }
            }
            // If requireAuth is explicitly false, enforce auth none in payload
            try {
                const pathsToCheck = [
                    { prefix: ['docker'], authPath: ['docker', 'auth'] },
                    { prefix: ['nuget'], authPath: ['nuget', 'auth'] },
                    { prefix: [], authPath: ['auth'] }
                ];

                pathsToCheck.forEach(({ prefix, authPath }) => {
                    const requireAuthPath = [...prefix, 'requireAuth'];
                    const requireAuthVal = getNested(payloadConfig, requireAuthPath);

                    if (requireAuthVal !== undefined) {
                        if (requireAuthVal === false) {
                            // Enforce auth none
                            payloadConfig = setNested(payloadConfig, authPath, { type: 'none' });
                        } else if (requireAuthVal === true) {
                            // Enforce basic if missing or none
                            const currentAuth = getNested(payloadConfig, authPath);
                            if (!currentAuth || currentAuth.type === 'none') {
                                payloadConfig = setNested(payloadConfig, authPath, { type: 'basic' });
                            }
                        }
                    }
                });
            } catch (e) { }

            if (selectedStorageId) {
                payloadConfig.storageId = selectedStorageId;
            }

            await axios.post('/api/repositories', {
                name: name,
                type: repoType,
                manager: manager,
                config: {
                    ...(payloadConfig || {}),
                    authEnabled: authEnabled,
                },
            });
            notify(`Repository "${name}" created successfully`);
            navigate('/admin/repos');
        } catch (err: any) {
            notify(err.response?.data?.message || 'Failed to create repository');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Box sx={{ maxWidth: '800px' }}>
            <Breadcrumbs separator={<ChevronRightIcon fontSize="small" />} aria-label="breadcrumbs" sx={{ mb: 0 }}>
                <Link color="neutral" href="/">
                    <HomeIcon />
                </Link>
                <Link color="neutral" href="/admin/repos">
                    Repositories
                </Link>
                <Typography>Create</Typography>
            </Breadcrumbs>

            <Typography level="h2" sx={{ mb: 1 }}>Create Repository</Typography>
            <Typography level="body-md" color="neutral" sx={{ mb: 3 }}>
                Configure a new repository.
            </Typography>

            <Divider sx={{ mb: 4 }} />

            <form onSubmit={handleSubmit}>
                <Stack spacing={4}>
                    <Box>
                        <Typography level="title-lg" sx={{ mb: 2 }}>Basic Information</Typography>
                        <Grid container spacing={2}>
                            <Grid xs={12}>
                                <FormControl required>
                                    <FormLabel>Name</FormLabel>
                                    <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="my-repo" />
                                </FormControl>
                            </Grid>
                            <Grid xs={12}>
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
                            </Grid>
                            <Grid xs={12} sm={6}>
                                <FormControl required>
                                    <FormLabel>Manager</FormLabel>
                                    <Select
                                        value={manager ?? ''}
                                        onChange={(_, val) => setManager(val || null)}
                                        placeholder={availableManagers.length ? undefined : 'No managers available'}
                                    >
                                        {availableManagers.map((m) => (
                                            <Option key={m.key} value={m.key}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    {m?.icon ? (
                                                        <img
                                                            src={`/api${m.icon}`}
                                                            alt={`${m.name || m.key} icon`}
                                                            style={{ width: 18, height: 18, objectFit: 'contain' }}
                                                            onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                                                        />
                                                    ) : (
                                                        <StorageIcon sx={{ width: 18, height: 18 }} />
                                                    )}
                                                    <div>{friendlyManager(m)}</div>
                                                </div>
                                            </Option>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Grid>
                            <Grid xs={12} sm={6}>
                                <FormControl required>
                                    <FormLabel>Mode</FormLabel>
                                    <Select value={repoType ?? ''} onChange={(_, val) => setRepoType(val || null)} disabled={!availableRepoTypes.length}>
                                        {availableRepoTypes.length === 0 && <Option value="">(select a manager)</Option>}
                                        {availableRepoTypes.map((t) => (
                                            <Option key={t} value={t}>{friendly(t)}</Option>
                                        ))}
                                    </Select>
                                </FormControl>
                            </Grid>
                        </Grid>
                        {pluginInfo ? (
                            <Typography level="body-sm" color="neutral" sx={{ mt: 1 }}>{pluginInfo}</Typography>
                        ) : null}
                    </Box>

                    <Box>
                        <Typography level="title-lg" sx={{ mb: 2 }}>Storage</Typography>
                        <FormControl>
                            <FormLabel>Storage Backend</FormLabel>
                            <Select
                                value={selectedStorageId ?? ''}
                                onChange={(_, val) => setSelectedStorageId(val)}
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
                        </FormControl>
                    </Box>

                    {pluginConfigSchema && repoType ? (
                        <Box>
                            <Typography level="title-lg" sx={{ mb: 2 }}>Configuration</Typography>
                            <Box>
                                {renderSchemaFields(resolveSchemaForRepoType(pluginConfigSchema, repoType), [])}
                            </Box>
                        </Box>
                    ) : null}

                    {renderRepoTypeSpecial() ? (
                        <Box>
                            <Typography level="title-lg" sx={{ mb: 2 }}>Additional Settings</Typography>
                            {renderRepoTypeSpecial()}
                        </Box>
                    ) : null}

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                        <Button variant="plain" color="neutral" onClick={() => navigate('/admin/repos')}>
                            Cancel
                        </Button>
                        <Button type="submit" loading={loading} disabled={!manager || !repoType}>
                            Create Repository
                        </Button>
                    </Box>
                </Stack>
            </form>
        </Box>
    );
}
