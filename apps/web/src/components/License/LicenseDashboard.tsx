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

import React, { useState, useEffect } from 'react';
import {
    Box,
    Card,
    CardContent,
    Typography,
    Stack,
    Button,
    Chip,
    LinearProgress,
    Alert,
    Divider,
} from '@mui/joy';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import WarningIcon from '@mui/icons-material/Warning';
import InfoIcon from '@mui/icons-material/Info';
import axios from 'axios';
import { useNotification } from '../NotificationSystem';

interface LicenseStatus {
    hasLicense: boolean;
    isActive: boolean;
    key?: string;
    type?: string;
    tier?: string; // Deprecated
    features?: Record<string, any>;
    createdAt?: string;
    lastValidatedAt?: string;
    validationStatus?: {
        valid: boolean;
        reason?: string;
    };
    subscriptionStatus?: string;
    nextPaymentDate?: number;
    expiresAt?: string;
}

interface LicenseMetrics {
    hasLicense: boolean;
    usage?: {
        currentRooms: number;
        currentUsers: number;
        storageUsedGB: number;
    };
}

export const LicenseDashboard: React.FC = () => {
    const { notify } = useNotification();
    const [status, setStatus] = useState<LicenseStatus | null>(null);
    const [metrics, setMetrics] = useState<LicenseMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [revalidating, setRevalidating] = useState(false);

    useEffect(() => {
        loadLicenseData();
    }, []);

    const loadLicenseData = async () => {
        try {
            const [statusRes, metricsRes] = await Promise.all([
                axios.get('/api/licenses/status'),
                axios.get('/api/licenses/metrics'),
            ]);

            setStatus(statusRes.data);
            setMetrics(metricsRes.data);
        } catch (error) {
            console.error('Error loading license data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRevalidate = async () => {
        setRevalidating(true);
        try {
            const response = await axios.post('/api/licenses/revalidate');
            if (response.data.success) {
                await loadLicenseData();
                notify('License revalidated successfully');
            } else {
                notify(`Error: ${response.data.message}`);
            }
        } catch (error) {
            console.error('Error revalidating license:', error);
            notify('Failed to revalidate license');
        } finally {
            setRevalidating(false);
        }
    };

    const getStatusColor = () => {
        if (!status?.hasLicense) return 'neutral';
        if (!status.isActive) return 'danger';
        if (!status.validationStatus?.valid) return 'warning';
        return 'success';
    };

    const getStatusText = () => {
        if (!status?.hasLicense) return 'No License';
        if (!status.isActive) return 'Inactive';
        if (!status.validationStatus?.valid) return 'Invalid';
        return 'Active';
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    };

    const formatDate = (dateString?: string) => {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleString();
    };

    const getTrialInfo = (expiresAt?: string) => {
        if (!expiresAt) return null;
        const now = new Date();
        const exp = new Date(expiresAt);
        const msLeft = exp.getTime() - now.getTime();
        const daysLeft = Math.ceil(msLeft / (1000 * 60 * 60 * 24));
        if (msLeft < 0) return `Trial expired on ${exp.toLocaleDateString()}`;
        if (daysLeft === 0) return `Trial ends today (${exp.toLocaleDateString()})`;
        return `Trial ends in ${daysLeft} day${daysLeft > 1 ? 's' : ''} (${exp.toLocaleDateString()})`;
    };

    if (loading) {
        return (
            <Card variant="outlined">
                <CardContent>
                    <Typography level="body-sm">Loading license information...</Typography>
                    <LinearProgress sx={{ mt: 2 }} />
                </CardContent>
            </Card>
        );
    }

    if (!status?.hasLicense) {
        return (
            <Card variant="outlined">
                <CardContent>
                    <Alert color="warning" startDecorator={<WarningIcon />}>
                        <Box>
                            <Typography level="title-sm">No Active License</Typography>
                            <Typography level="body-sm">
                                System is running in Community mode with limited functionality
                            </Typography>
                        </Box>
                    </Alert>
                </CardContent>
            </Card>
        );
    }

    return (
        <Stack spacing={3}>
            {/* Validation Status Alert */}
            {!status.validationStatus?.valid && (
                <Alert color="danger" startDecorator={<ErrorIcon />} variant="soft">
                    <Box>
                        <Typography level="title-sm">Invalid License</Typography>
                        <Typography level="body-sm">
                            {status.validationStatus?.reason || 'License validation failed'}
                        </Typography>
                    </Box>
                </Alert>
            )}

            {/* License Overview */}
            <Card variant="outlined">
                <CardContent>
                    <Stack spacing={2}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography level="title-md">License Status</Typography>
                            <Button
                                size="sm"
                                variant="outlined"
                                startDecorator={<RefreshIcon />}
                                onClick={handleRevalidate}
                                loading={revalidating}
                            >
                                Revalidate
                            </Button>
                        </Box>

                        <Divider />

                        <Stack spacing={1}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    Status:
                                </Typography>
                                <Chip size="sm" variant="soft" color={getStatusColor()}>
                                    {getStatusText()}
                                </Chip>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    Type:
                                </Typography>
                                <Typography level="body-sm" fontWeight="lg">
                                    {(status.type || status.tier)?.toUpperCase()}
                                </Typography>
                            </Box>
                            {/* Subscription is only relevant for paid/enterprise licenses */}
                            {(status.type || status.tier) !== 'trial' && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                        Subscription:
                                    </Typography>
                                    <Chip
                                        size="sm"
                                        variant="soft"
                                        color={status.subscriptionStatus === 'active' ? 'success' : 'danger'}
                                    >
                                        {status.subscriptionStatus === 'active' ? 'Active' : 'Cancelled'}
                                    </Chip>
                                </Box>
                            )}
                            {status.nextPaymentDate && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                        Next Payment:
                                    </Typography>
                                    <Typography level="body-sm">
                                        {formatDate(new Date(status.nextPaymentDate).toISOString())}
                                    </Typography>
                                </Box>
                            )}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    License Key:
                                </Typography>
                                <Typography level="body-xs" fontFamily="monospace">
                                    {status.key}
                                </Typography>
                            </Box>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            <Card variant="outlined">
                <CardContent>
                    <Stack spacing={2}>
                        <Typography level="title-md">Validation Info</Typography>
                        <Divider />
                        <Stack spacing={1}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    Activated:
                                </Typography>
                                <Typography level="body-sm">
                                    {formatDate(status.createdAt)}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    Last Validated:
                                </Typography>
                                <Typography level="body-sm">
                                    {formatDate(status.lastValidatedAt)}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                    Auto Validation:
                                </Typography>
                                <Chip size="sm" variant="soft" color="primary">
                                    Every 15 minutes
                                </Chip>
                            </Box>
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            {/* Info Alert */}
            <Alert color="primary" startDecorator={<InfoIcon />} variant="soft">
                <Box>
                    {(status.type || status.tier) === 'trial' ? (
                        <>
                            <Typography level="title-sm">Trial</Typography>
                            <Typography level="body-sm">{getTrialInfo(status.expiresAt) || 'Trial information not available'}</Typography>
                        </>
                    ) : (
                        <>
                            <Typography level="title-sm">Monthly Billing</Typography>
                            <Typography level="body-sm">Your license renews automatically each month. You can cancel anytime from your Stripe account.</Typography>
                        </>
                    )}
                </Box>
            </Alert>
        </Stack>
    );
};
