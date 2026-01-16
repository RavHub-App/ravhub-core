import { useEffect, useState } from 'react';
import {
    Typography,
    Card,
    CardContent,
    Divider,
    List,
    ListItem,
    ListItemContent,
    Box,
    Chip,
    FormControl,
    FormLabel,
    Input,
    Select,
    Option,
    Button,
    Stack,
} from '@mui/joy';
import HistoryIcon from '@mui/icons-material/History';
import axios from 'axios';
import { useNotification } from '../NotificationSystem';

interface AuditLog {
    id: string;
    userId: string;
    user?: { username: string };
    action: string;
    entityType?: string;
    entityId?: string;
    details?: Record<string, any>;
    ipAddress?: string;
    userAgent?: string;
    status: 'success' | 'failure';
    error?: string;
    timestamp: string;
}

export default function AuditLogs() {
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const { notify } = useNotification();

    // Filters
    const [action, setAction] = useState('');
    const [status, setStatus] = useState<string>('');
    const [userId, setUserId] = useState('');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [limit] = useState(50);
    const [offset, setOffset] = useState(0);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (action) params.append('action', action);
            if (status) params.append('status', status);
            if (userId) params.append('userId', userId);
            if (startDate) params.append('startDate', startDate);
            if (endDate) params.append('endDate', endDate);
            params.append('limit', limit.toString());
            params.append('offset', offset.toString());

            const res = await axios.get(`/api/audit?${params.toString()}`);
            setLogs(res.data.logs || []);
            setTotal(res.data.total || 0);
        } catch (err) {
            notify('Failed to fetch audit logs');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchLogs();

        // Polling every 5 seconds
        const interval = setInterval(() => {
            fetchLogs();
        }, 5000);

        return () => clearInterval(interval);
    }, [limit, offset]);

    const handleSearch = () => {
        setOffset(0);
        fetchLogs();
    };

    const handleClear = () => {
        setAction('');
        setStatus('');
        setUserId('');
        setStartDate('');
        setEndDate('');
        setOffset(0);
        setTimeout(() => fetchLogs(), 100);
    };

    const getStatusColor = (status: string) => {
        return status === 'success' ? 'success' : 'danger';
    };

    const formatDate = (dateStr: string) => {
        return new Date(dateStr).toLocaleString();
    };

    return (
        <Card variant="outlined">
            <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <HistoryIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                        <Box>
                            <Typography level="title-md">Audit Logs</Typography>
                            <Typography level="body-sm">System event logs and audit trail</Typography>
                        </Box>
                    </Box>
                    <Typography level="body-sm" color="neutral">
                        {total} total events
                    </Typography>
                </Box>

                <Divider />

                {/* Filters */}
                <Box sx={{ mt: 2, mb: 2 }}>
                    <Stack spacing={2}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2 }}>
                            <FormControl size="sm">
                                <FormLabel>Action</FormLabel>
                                <Input
                                    value={action}
                                    onChange={(e) => setAction(e.target.value)}
                                    placeholder="e.g. auth.login"
                                    size="sm"
                                />
                            </FormControl>

                            <FormControl size="sm">
                                <FormLabel>Status</FormLabel>
                                <Select
                                    value={status}
                                    onChange={(_, val) => setStatus(val as string)}
                                    size="sm"
                                >
                                    <Option value="">All</Option>
                                    <Option value="success">Success</Option>
                                    <Option value="failure">Failure</Option>
                                </Select>
                            </FormControl>

                            <FormControl size="sm">
                                <FormLabel>Start Date</FormLabel>
                                <Input
                                    type="datetime-local"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    size="sm"
                                />
                            </FormControl>

                            <FormControl size="sm">
                                <FormLabel>End Date</FormLabel>
                                <Input
                                    type="datetime-local"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    size="sm"
                                />
                            </FormControl>
                        </Box>

                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button size="sm" onClick={handleSearch} loading={loading}>
                                Search
                            </Button>
                            <Button size="sm" variant="soft" color="neutral" onClick={handleClear}>
                                Clear
                            </Button>
                        </Box>
                    </Stack>
                </Box>

                <Divider />

                {/* Logs List */}
                <List sx={{ '--ListItem-paddingY': '0.75rem', '--ListItem-paddingX': '1rem', mt: 2 }}>
                    {logs.map((log) => (
                        <ListItem
                            key={log.id}
                            sx={{
                                borderRadius: 'sm',
                                mb: 0.5,
                                '&:hover': {
                                    bgcolor: 'background.level1',
                                },
                            }}
                        >
                            <ListItemContent>
                                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <Typography level="title-sm">{log.action}</Typography>
                                        <Chip size="sm" color={getStatusColor(log.status)} variant="soft">
                                            {log.status}
                                        </Chip>
                                        {log.entityType && (
                                            <Chip size="sm" variant="outlined" color="neutral">
                                                {log.entityType}
                                            </Chip>
                                        )}
                                    </Box>

                                    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                        <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                            <strong>User:</strong> {log.user?.username || log.userId || 'System'}
                                        </Typography>
                                        <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                            <strong>Time:</strong> {formatDate(log.timestamp)}
                                        </Typography>
                                        {log.ipAddress && (
                                            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                                                <strong>IP:</strong> {log.ipAddress}
                                            </Typography>
                                        )}
                                    </Box>

                                    {log.error && (
                                        <Typography level="body-xs" sx={{ color: 'danger.500' }}>
                                            <strong>Error:</strong> {log.error}
                                        </Typography>
                                    )}

                                    {log.details && Object.keys(log.details).length > 0 && (
                                        <Typography
                                            level="body-xs"
                                            sx={{
                                                color: 'text.tertiary',
                                                fontFamily: 'monospace',
                                                fontSize: '0.75rem',
                                            }}
                                        >
                                            {JSON.stringify(log.details, null, 2)}
                                        </Typography>
                                    )}
                                </Box>
                            </ListItemContent>
                        </ListItem>
                    ))}

                    {logs.length === 0 && !loading && (
                        <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                            <Typography level="body-sm" color="neutral">
                                No audit logs found
                            </Typography>
                        </ListItem>
                    )}

                    {loading && (
                        <ListItem sx={{ justifyContent: 'center', py: 4 }}>
                            <Typography level="body-sm" color="neutral">
                                Loading...
                            </Typography>
                        </ListItem>
                    )}
                </List>

                {/* Pagination */}
                {total > limit && (
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 2 }}>
                        <Typography level="body-sm">
                            Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                            <Button
                                size="sm"
                                variant="outlined"
                                disabled={offset === 0}
                                onClick={() => setOffset(Math.max(0, offset - limit))}
                            >
                                Previous
                            </Button>
                            <Button
                                size="sm"
                                variant="outlined"
                                disabled={offset + limit >= total}
                                onClick={() => setOffset(offset + limit)}
                            >
                                Next
                            </Button>
                        </Box>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
}
