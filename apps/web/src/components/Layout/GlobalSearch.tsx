import { useState, useEffect, useRef } from 'react';
import {
    Input,
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemContent,
    Typography,
    Chip,
    Sheet,
    CircularProgress,
    ListItemDecorator,
    IconButton,
} from '@mui/joy';
import SearchIcon from '@mui/icons-material/Search';
import FolderIcon from '@mui/icons-material/Folder';
import InventoryIcon from '@mui/icons-material/Inventory';
import BackupIcon from '@mui/icons-material/Backup';
import CloseIcon from '@mui/icons-material/Close';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

interface SearchResult {
    id: string;
    type: 'repository' | 'artifact' | 'backup';
    title: string;
    subtitle?: string;
    metadata?: Record<string, any>;
    repoName?: string;
}

export default function GlobalSearch() {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [showResults, setShowResults] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
                setShowResults(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!query.trim()) {
            setResults([]);
            setShowResults(false);
            return;
        }

        const timeoutId = setTimeout(async () => {
            setLoading(true);
            try {
                const [repos, artifacts, backups] = await Promise.all([
                    axios.get('/api/repositories').catch(() => ({ data: [] })),
                    axios.get('/api/repositories').then(async (res) => {
                        const allArtifacts = [];
                        for (const repo of res.data.slice(0, 5)) {
                            try {
                                const packages = await axios.get(`/api/repositories/${repo.id}/packages`);
                                for (const pkg of packages.data.slice(0, 3)) {
                                    allArtifacts.push({
                                        id: `${repo.id}-${pkg.name}`,
                                        type: 'artifact' as const,
                                        title: pkg.name,
                                        subtitle: `${repo.name} · ${pkg.versions?.length || 0} versions`,
                                        metadata: { repository: repo.name, versions: pkg.versions?.length },
                                        repoName: repo.name,
                                    });
                                }
                            } catch { }
                        }
                        return allArtifacts;
                    }).catch(() => []),
                    axios.get('/api/backups').catch(() => ({ data: [] })),
                ]);

                const searchResults: SearchResult[] = [];

                // Filter repositories
                if (repos.data) {
                    repos.data
                        .filter((r: any) =>
                            r.name?.toLowerCase().includes(query.toLowerCase()) ||
                            r.description?.toLowerCase().includes(query.toLowerCase())
                        )
                        .slice(0, 3)
                        .forEach((r: any) => {
                            searchResults.push({
                                id: r.id,
                                type: 'repository',
                                title: r.name,
                                subtitle: r.description || `${r.type} repository · ${r.manager}`,
                                metadata: { type: r.type, manager: r.manager },
                            });
                        });
                }

                // Filter artifacts
                artifacts
                    .filter((a: any) => a.title?.toLowerCase().includes(query.toLowerCase()))
                    .slice(0, 5)
                    .forEach((a: any) => searchResults.push(a));

                // Filter backups
                if (backups.data) {
                    backups.data
                        .filter((b: any) =>
                            b.name?.toLowerCase().includes(query.toLowerCase()) ||
                            b.description?.toLowerCase().includes(query.toLowerCase())
                        )
                        .slice(0, 3)
                        .forEach((b: any) => {
                            searchResults.push({
                                id: b.id,
                                type: 'backup',
                                title: b.name,
                                subtitle: `${b.type} · ${b.status}`,
                                metadata: { type: b.type, status: b.status },
                            });
                        });
                }

                setResults(searchResults);
                setShowResults(searchResults.length > 0);
            } catch (error) {
                console.error('Search error:', error);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [query]);

    const handleResultClick = (result: SearchResult) => {
        switch (result.type) {
            case 'repository':
                navigate(`/admin/repos/${result.title}`);
                break;
            case 'artifact':
                if (result.repoName) {
                    navigate(`/repos/${result.repoName}`);
                }
                break;
            case 'backup':
                navigate('/settings?tab=2');
                break;
        }
        setQuery('');
        setShowResults(false);
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'repository':
                return <FolderIcon fontSize="small" />;
            case 'artifact':
                return <InventoryIcon fontSize="small" />;
            case 'backup':
                return <BackupIcon fontSize="small" />;
            default:
                return <SearchIcon fontSize="small" />;
        }
    };

    const getTypeColor = (type: string) => {
        switch (type) {
            case 'repository':
                return 'primary';
            case 'artifact':
                return 'success';
            case 'backup':
                return 'warning';
            default:
                return 'neutral';
        }
    };

    return (
        <Box ref={searchRef} sx={{ position: 'relative', width: { xs: 200, md: 400 } }}>
            <Input
                placeholder="Search repositories, packages, backups..."
                startDecorator={loading ? <CircularProgress size="sm" /> : <SearchIcon />}
                endDecorator={
                    query && (
                        <IconButton
                            size="sm"
                            variant="plain"
                            color="neutral"
                            onClick={() => {
                                setQuery('');
                                setShowResults(false);
                            }}
                        >
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    )
                }
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => {
                    if (results.length > 0) setShowResults(true);
                }}
                sx={{
                    width: '100%',
                    '--Input-focusedThickness': '2px',
                }}
            />

            {showResults && results.length > 0 && (
                <Sheet
                    variant="outlined"
                    sx={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        left: 0,
                        right: 0,
                        maxHeight: 450,
                        overflowY: 'auto',
                        borderRadius: 'md',
                        boxShadow: 'lg',
                        zIndex: 1100,
                        bgcolor: 'background.popup',
                        border: '1px solid',
                        borderColor: 'neutral.outlinedBorder',
                        p: 1,
                    }}
                >
                    <List size="sm" sx={{ '--ListItem-paddingY': '8px' }}>
                        {results.map((result) => (
                            <ListItem key={`${result.type}-${result.id}`}>
                                <ListItemButton
                                    onClick={() => handleResultClick(result)}
                                    sx={{
                                        borderRadius: 'sm',
                                        '&:hover': {
                                            bgcolor: 'background.level1',
                                        }
                                    }}
                                >
                                    <ListItemDecorator sx={{ minInlineSize: 32 }}>
                                        <Box
                                            sx={{
                                                color: `${getTypeColor(result.type)}.500`,
                                                display: 'flex',
                                                alignItems: 'center',
                                            }}
                                        >
                                            {getIcon(result.type)}
                                        </Box>
                                    </ListItemDecorator>
                                    <ListItemContent>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                            <Typography
                                                level="title-sm"
                                                sx={{
                                                    fontWeight: 600,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {result.title}
                                            </Typography>
                                            <Chip
                                                size="sm"
                                                variant="soft"
                                                color={getTypeColor(result.type) as any}
                                                sx={{
                                                    textTransform: 'capitalize',
                                                    fontSize: '0.75rem',
                                                    minHeight: '20px',
                                                    py: 0,
                                                }}
                                            >
                                                {result.type}
                                            </Chip>
                                        </Box>
                                        {result.subtitle && (
                                            <Typography
                                                level="body-xs"
                                                sx={{
                                                    color: 'text.tertiary',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {result.subtitle}
                                            </Typography>
                                        )}
                                    </ListItemContent>
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                </Sheet>
            )}

            {showResults && query && results.length === 0 && !loading && (
                <Sheet
                    variant="outlined"
                    sx={{
                        position: 'absolute',
                        top: 'calc(100% + 8px)',
                        left: 0,
                        right: 0,
                        p: 2,
                        borderRadius: 'md',
                        boxShadow: 'lg',
                        zIndex: 1100,
                        bgcolor: 'background.popup',
                    }}
                >
                    <Typography level="body-sm" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                        No results found for "{query}"
                    </Typography>
                </Sheet>
            )}
        </Box>
    );
}
