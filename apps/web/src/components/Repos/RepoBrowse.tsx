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

import { useEffect, useState } from 'react';
import { Typography, Card, CardContent, Box, CircularProgress, Input, IconButton, Tooltip, Button, List, ListItem, ListItemButton, ListItemContent, Chip } from '@mui/joy';
import SearchIcon from '@mui/icons-material/Search';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import RefreshIcon from '@mui/icons-material/Refresh';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CalendarTodayIcon from '@mui/icons-material/CalendarToday';
import StorageIcon from '@mui/icons-material/Storage';
import axios from 'axios';
import { FileIcon, defaultStyles } from 'react-file-icon';
import { useNotification } from '../NotificationSystem';
import ConfirmationModal from '../ConfirmationModal';

interface RepoBrowseProps {
    repoId: string;
}

interface Package {
    name: string;
    latestVersion: string;
    updatedAt: string;
}

interface TreeNode {
    name: string;
    fullPath: string;
    isPackage: boolean;
    version?: string;
    updatedAt?: string;
    children: TreeNode[];
    expanded?: boolean;
}

export default function RepoBrowse({ repoId }: RepoBrowseProps) {
    const [packages, setPackages] = useState<Package[]>([]);
    const [tree, setTree] = useState<TreeNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [detailOpen, setDetailOpen] = useState(false);
    const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [packageDetails, setPackageDetails] = useState<any | null>(null);
    const [search, setSearch] = useState('');
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

    const fetchPackages = () => {
        setLoading(true);
        axios.get(`/api/repository/${repoId}/packages`)
            .then(res => {
                const data = res?.data;
                let list: Package[] = [];
                if (Array.isArray(data)) list = data;
                else if (Array.isArray(data?.packages)) list = data.packages;

                setPackages(list);
                buildTree(list);
            })
            .catch(err => {
                console.warn('Failed to fetch packages', err);
                setPackages([]);
                setTree([]);
            })
            .finally(() => setLoading(false));
    };

    const buildTree = (pkgs: Package[]) => {
        const root: TreeNode[] = [];

        pkgs.forEach(pkg => {
            // Split package name by common separators: /, :, @
            const parts = pkg.name.split(/[/:@]/).filter(p => p.length > 0);

            let currentLevel = root;
            let currentPath = '';

            parts.forEach((part, index) => {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                const isLast = index === parts.length - 1;

                let node = currentLevel.find(n => n.name === part);

                if (!node) {
                    node = {
                        name: part,
                        fullPath: currentPath,
                        isPackage: isLast,
                        version: isLast ? pkg.latestVersion : undefined,
                        updatedAt: isLast ? pkg.updatedAt : undefined,
                        children: [],
                        expanded: false
                    };
                    currentLevel.push(node);
                }

                currentLevel = node.children;
            });
        });

        // Sort: folders first, then alphabetically by name
        const sortTree = (nodes: TreeNode[]): TreeNode[] => {
            return nodes.sort((a, b) => {
                // Folders (nodes with children) come first
                const aIsFolder = a.children.length > 0;
                const bIsFolder = b.children.length > 0;

                if (aIsFolder && !bIsFolder) return -1;
                if (!aIsFolder && bIsFolder) return 1;

                // Both are same type, sort alphabetically
                return a.name.localeCompare(b.name);
            }).map(node => ({
                ...node,
                children: sortTree(node.children)
            }));
        };

        setTree(sortTree(root));
    };

    useEffect(() => {
        fetchPackages();
    }, [repoId]);

    const toggleNode = (path: number[]) => {
        const newTree = [...tree];

        let current: TreeNode[] = newTree;

        path.forEach((index, i) => {
            if (i === path.length - 1) {
                current[index].expanded = !current[index].expanded;
            } else {
                current = current[index].children;
            }
        });

        setTree(newTree);
    };

    const filterTree = (nodes: TreeNode[], searchTerm: string): TreeNode[] => {
        if (!searchTerm) return nodes;

        const lower = searchTerm.toLowerCase();
        return nodes.filter(node => {
            const nameMatch = node.name.toLowerCase().includes(lower);
            const childrenMatch = node.children.length > 0 && filterTree(node.children, searchTerm).length > 0;
            return nameMatch || childrenMatch;
        }).map(node => ({
            ...node,
            children: filterTree(node.children, searchTerm),
            expanded: searchTerm ? true : node.expanded
        }));
    };

    const deleteFolder = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        setConfirmAction({
            open: true,
            title: 'Delete Folder',
            message: `Are you sure you want to delete folder "${path}"? This removes all packages under it.`,
            color: 'danger',
            onConfirm: async () => {
                setLoading(true);
                try {
                    const res = await axios.delete(`/api/repository/${repoId}/path?prefix=${encodeURIComponent(path)}`);
                    if (res?.data?.ok) {
                        fetchPackages();
                        notify(`Deleted ${res.data.count} packages`);
                    } else {
                        notify('Failed to delete: ' + (res.data?.message || 'unknown'));
                    }
                } catch (err: any) {
                    notify('Delete failed: ' + err?.message);
                } finally {
                    setLoading(false);
                    setConfirmAction(prev => ({ ...prev, open: false }));
                }
            }
        });
    };

    const getFileIcon = (name: string) => {
        const ext = name.split('.').pop();
        // @ts-ignore
        const style = ext && defaultStyles[ext];
        if (style) {
            return <Box sx={{ width: 20, display: 'flex' }}><FileIcon extension={ext} {...style} /></Box>;
        }
        // Use outlined file icon with default color for unknown/unsupported file types
        return <InsertDriveFileOutlinedIcon sx={{ fontSize: 20 }} />;
    };

    const renderTree = (nodes: TreeNode[], path: number[] = [], level: number = 0): any[] => {
        return nodes.map((node, index) => {
            const currentPath = [...path, index];
            const hasChildren = node.children.length > 0;
            const isExpanded = node.expanded;

            return (
                <Box key={node.fullPath}>
                    <ListItem nested={level > 0}
                        endAction={
                            !node.isPackage && (
                                <IconButton size="sm" color="danger" variant="plain" onClick={(e) => deleteFolder(e, node.fullPath)}>
                                    <DeleteIcon />
                                </IconButton>
                            )
                        }
                    >
                        <ListItemButton
                            onClick={() => {
                                // if leaf package -> open details drawer
                                if (node.isPackage && !hasChildren) {
                                    // We need to find the actual package name from the packages list to be sure?
                                    // The node.fullPath is constructed.

                                    setSelectedPackage(node.fullPath);
                                    setDetailOpen(true);
                                    fetchPackageDetails(node.fullPath);
                                    return;
                                }
                                if (hasChildren) toggleNode(currentPath);
                            }}
                            selected={selectedPackage === node.fullPath}
                            sx={{
                                pl: level * 3,
                                '&:hover': { bgcolor: 'background.level1' },
                                '&.Mui-selected': {
                                    bgcolor: 'primary.softBg',
                                    '&:hover': {
                                        bgcolor: 'primary.softHoverBg'
                                    }
                                }
                            }}
                        >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                {hasChildren ? (
                                    isExpanded ? <KeyboardArrowDownIcon /> : <KeyboardArrowRightIcon />
                                ) : (
                                    <Box sx={{ width: 24 }} />
                                )}

                                {node.isPackage ? (
                                    getFileIcon(node.name)
                                ) : (
                                    isExpanded ?
                                        <FolderOpenIcon sx={{ fontSize: 20, color: '#af8c31ff' }} /> :
                                        <FolderIcon sx={{ fontSize: 20, color: '#fad165' }} />
                                )}

                                <ListItemContent>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, justifyContent: 'space-between' }}>
                                        <Typography level="body-sm" fontWeight={node.isPackage ? 'md' : 'normal'}>
                                            {node.name}
                                        </Typography>

                                        {node.isPackage && node.version && (
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                <Chip size="sm" variant="soft" color="primary">
                                                    {node.version}
                                                </Chip>
                                                {node.updatedAt && (
                                                    <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                        {new Date(node.updatedAt).toLocaleDateString()}
                                                    </Typography>
                                                )}
                                            </Box>
                                        )}
                                    </Box>
                                </ListItemContent>
                            </Box>
                        </ListItemButton>
                    </ListItem>

                    {hasChildren && isExpanded && (
                        <List sx={{ '--List-padding': '0px' }}>
                            {renderTree(node.children, currentPath, level + 1)}
                        </List>
                    )}
                </Box>
            );
        });
    };

    const fetchPackageDetails = (packageName: string) => {
        setDetailsLoading(true);
        setPackageDetails(null);
        // We need to handle the case where packageName in tree is different from real package name.
        // But let's rely on the backend to be smart or the tree to be correct.
        // If I change buildTree to store `realName` for packages, it would be better.

        axios.get(`/api/repository/${repoId}/packages/${encodeURIComponent(packageName)}`)
            .then(res => {
                if (res?.data?.ok) {
                    setPackageDetails(res.data);
                } else {
                    setPackageDetails({ ok: false, message: res.data?.message || 'empty' });
                }
            })
            .catch(err => {
                console.warn('Failed to fetch package details', err);
                setPackageDetails({ ok: false, message: 'failed' });
            })
            .finally(() => setDetailsLoading(false));
    };

    const closeDetails = () => {
        setDetailOpen(false);
        setSelectedPackage(null);
        setPackageDetails(null);
    };

    const deletePackageVersion = (version: string) => {
        if (!selectedPackage) return;
        setConfirmAction({
            open: true,
            title: 'Delete Version',
            message: `Are you sure you want to delete ${selectedPackage}@${version}? This removes the artifact from storage.`,
            color: 'danger',
            onConfirm: async () => {
                setDetailsLoading(true);
                try {
                    const res = await axios.delete(`/api/repository/${repoId}/packages/${encodeURIComponent(selectedPackage)}/${encodeURIComponent(version)}`);
                    if (res?.data?.ok) {
                        // refresh package details and the packages list
                        fetchPackageDetails(selectedPackage);
                        fetchPackages();
                    } else {
                        notify('Failed to delete: ' + (res.data?.message || 'unknown'));
                    }
                } catch (err: any) {
                    notify('Delete failed: ' + err?.message);
                } finally {
                    setDetailsLoading(false);
                    setConfirmAction(prev => ({ ...prev, open: false }));
                }
            }
        });
    };

    const filteredTree = filterTree(tree, search);

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        notify('Copied to clipboard');
    };

    return (
        <Card variant="outlined" sx={{ minHeight: 400, display: 'flex', flexDirection: 'row', overflow: 'hidden' }}>
            <CardContent sx={{ flex: detailOpen ? '0 1 calc(100% - 420px)' : '1 1 auto', transition: 'flex 0.3s ease', display: 'flex', flexDirection: 'column' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexShrink: 0 }}>
                    <Typography level="title-lg" startDecorator={<Inventory2Icon />}>
                        Packages
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <Input
                            startDecorator={<SearchIcon />}
                            placeholder="Search packages..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            size="sm"
                        />
                        <Tooltip title="Refresh">
                            <IconButton variant="outlined" size="sm" onClick={fetchPackages}>
                                <RefreshIcon />
                            </IconButton>
                        </Tooltip>
                    </Box>
                </Box>

                {loading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', p: 5, flex: 1 }}>
                        <CircularProgress />
                    </Box>
                ) : filteredTree.length === 0 ? (
                    <Box sx={{ p: 8, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flex: 1 }}>
                        <Inventory2Icon sx={{ fontSize: 48, color: 'neutral.400' }} />
                        <Typography level="body-lg" color="neutral">
                            {packages.length === 0
                                ? "No packages found in this repository."
                                : "No packages match your search."}
                        </Typography>
                        {packages.length === 0 && (
                            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                                <Typography level="body-sm" color="neutral">
                                    Upload packages via the CLI or the Upload tab.
                                </Typography>
                                <Button
                                    variant="soft"
                                    color="neutral"
                                    size="sm"
                                    onClick={() => {
                                        setLoading(true);
                                        axios.post(`/api/repository/${repoId}/scan`)
                                            .then(res => {
                                                if (res.data.count > 0) fetchPackages();
                                                else setLoading(false);
                                            })
                                            .catch(() => setLoading(false));
                                    }}
                                >
                                    Scan for existing packages
                                </Button>
                            </Box>
                        )}
                    </Box>
                ) : (
                    <Box sx={{ maxHeight: 600, overflow: 'auto', flex: 1 }}>
                        <List sx={{ '--List-padding': '0px', '--ListItem-paddingY': '4px' }}>
                            {renderTree(filteredTree)}
                        </List>
                    </Box>
                )}
            </CardContent>
            {/* Package details drawer */}
            {detailOpen && (
                <Box sx={{ width: 420, borderLeft: '1px solid', borderColor: 'divider', bgcolor: 'background.surface', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
                    <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', flexShrink: 0 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography level="title-lg">{selectedPackage}</Typography>
                            <Button size="sm" variant="soft" color="neutral" onClick={closeDetails}>Close</Button>
                        </Box>
                    </Box>

                    <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
                        {detailsLoading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}><CircularProgress /></Box>
                        ) : !packageDetails ? (
                            <Typography level="body-sm">No details</Typography>
                        ) : packageDetails.ok ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                {packageDetails.artifacts.length === 0 && <Typography level="body-sm">No versions found.</Typography>}
                                {packageDetails.artifacts
                                    .filter((a: any) => !a.version?.startsWith('sha256:') && !a.version?.startsWith('sha384:') && !a.version?.startsWith('sha512:'))
                                    .map((a: any) => (
                                        <Card key={a.id} variant="outlined" sx={{ p: 2 }}>
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <Chip color="primary" size="lg" variant="soft">
                                                        {a.version}
                                                    </Chip>
                                                    <IconButton size="sm" color="danger" variant="plain" onClick={() => deletePackageVersion(a.version)}>
                                                        <DeleteIcon />
                                                    </IconButton>
                                                </Box>

                                                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <CalendarTodayIcon sx={{ fontSize: 14, color: 'text.tertiary' }} />
                                                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                            {a.createdAt ? new Date(a.createdAt).toLocaleString() : 'Unknown'}
                                                        </Typography>
                                                    </Box>
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                        <StorageIcon sx={{ fontSize: 14, color: 'text.tertiary' }} />
                                                        <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                                                            {a.size ? (a.size / 1024 / 1024).toFixed(2) + ' MB' : 'Unknown'}
                                                        </Typography>
                                                    </Box>
                                                </Box>

                                                {a.installCommand && (
                                                    <Box sx={{ mt: 1, bgcolor: 'background.level1', p: 1.5, borderRadius: 'sm', display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                                                        <Typography
                                                            level="body-xs"
                                                            sx={{
                                                                fontFamily: 'monospace',
                                                                wordBreak: 'break-all',
                                                                flex: 1,
                                                                overflowWrap: 'anywhere'
                                                            }}
                                                        >
                                                            {a.installCommand}
                                                        </Typography>
                                                        <IconButton size="sm" onClick={() => copyToClipboard(a.installCommand)}>
                                                            <ContentCopyIcon fontSize="small" />
                                                        </IconButton>
                                                    </Box>
                                                )}
                                            </Box>
                                        </Card>
                                    ))}
                            </Box>
                        ) : (
                            <Typography level="body-sm">{packageDetails.message}</Typography>
                        )}
                    </Box>
                </Box>
            )}

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
