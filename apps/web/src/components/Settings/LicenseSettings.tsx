import { useEffect, useState } from 'react';
import {
    Typography,
    Card,
    CardContent,
    Button,
    Stack,
    FormControl,
    FormLabel,
    Input,
    Chip,
    Box,
    Divider,
    Alert,
    LinearProgress,
} from '@mui/joy';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import RefreshIcon from '@mui/icons-material/Refresh';
import InfoIcon from '@mui/icons-material/Info';
import DeleteIcon from '@mui/icons-material/Delete';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import IconButton from '@mui/joy/IconButton';
import axios from 'axios';
import { useNotification } from '../NotificationSystem';
import ConfirmationModal from '../ConfirmationModal';

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


export default function LicenseSettings() {
    const [status, setStatus] = useState<LicenseStatus | null>(null);
    // const [metrics, setMetrics] = useState<LicenseMetrics | null>(null);
    const [loading, setLoading] = useState(true);
    const [activating, setActivating] = useState(false);
    const [revalidating, setRevalidating] = useState(false);
    const [deactivating, setDeactivating] = useState(false);
    const [purchaseLoading, setPurchaseLoading] = useState(false);
    const [licenseKey, setLicenseKey] = useState('');
    const [showKey, setShowKey] = useState(false);
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

    useEffect(() => {
        loadLicenseData();
    }, []);

    const loadLicenseData = async () => {
        try {
            const statusRes = await axios.get('/api/licenses/status');
            setStatus(statusRes.data);
        } catch (error) {
            console.error('Error loading license data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handlePurchase = async () => {
        setPurchaseLoading(true);
        try {
            // Get portal URL from environment or config
            const portalUrl = import.meta.env.VITE_LICENSE_PORTAL_URL || 'https://license.yourdomain.com';
            window.open(`${portalUrl}/checkout`, '_blank');
            notify('Opening license purchase page...');
        } catch (error) {
            notify('Failed to open purchase page');
        } finally {
            setPurchaseLoading(false);
        }
    };

    const handleManageSubscription = () => {
        if (status?.subscriptionStatus !== 'active') {
            notify('No active subscription found to manage');
            return;
        }
        const portalUrl = import.meta.env.VITE_LICENSE_PORTAL_URL || 'https://license.yourdomain.com';
        window.open(`${portalUrl}/dashboard`, '_blank');
        notify('Opening billing management...');
    };

    const handleActivate = async () => {
        if (!licenseKey.trim()) {
            notify('Please enter a license key');
            return;
        }

        setActivating(true);
        try {
            const response = await axios.post('/api/licenses/activate', {
                key: licenseKey,
            });

            if (response.data.success) {
                notify('License activated successfully');
                setLicenseKey('');
                loadLicenseData();
            } else {
                notify(response.data.message || 'License activation failed');
            }
        } catch (err: any) {
            notify(err.response?.data?.message || 'Failed to activate license');
        } finally {
            setActivating(false);
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

    const handleDeactivate = async () => {
        setConfirmAction({
            open: true,
            title: 'Remove License',
            message: 'Are you sure you want to remove the license? This will disable enterprise features.',
            color: 'danger',
            onConfirm: async () => {
                setDeactivating(true);
                try {
                    const response = await axios.post('/api/licenses/deactivate');
                    if (response.data.success) {
                        await loadLicenseData();
                        notify('License removed successfully');
                    } else {
                        notify(`Error: ${response.data.message}`);
                    }
                } catch (error) {
                    console.error('Error deactivating license:', error);
                    notify('Failed to remove license');
                } finally {
                    setDeactivating(false);
                    setConfirmAction(prev => ({ ...prev, open: false }));
                }
            }
        });
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

    return (
        <Stack spacing={3}>
            {/* No Active License - Purchase CTA */}
            {!status?.hasLicense && (
                <Card variant="outlined" color="primary">
                    <CardContent>
                        <Stack spacing={2}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                <ShoppingCartIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                                <Box>
                                    <Typography level="title-md">Upgrade to Enterprise</Typography>
                                    <Typography level="body-sm">Unlock enterprise features for your organization</Typography>
                                </Box>
                            </Box>

                            <Divider />

                            <Box>
                                <Typography level="body-sm" sx={{ color: 'text.secondary', mb: 2 }}>
                                    Get access to all enterprise features.
                                </Typography>
                            </Box>

                            <Button
                                size="lg"
                                startDecorator={<ShoppingCartIcon />}
                                loading={purchaseLoading}
                                onClick={handlePurchase}
                            >
                                Get Enterprise License
                            </Button>

                            <Typography level="body-xs" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                                Secure payment via Stripe • Monthly subscription • Cancel anytime
                            </Typography>
                        </Stack>
                    </CardContent>
                </Card>
            )}

            {/* Validation Error Alert */}
            {status?.hasLicense && !status.validationStatus?.valid && (
                <Alert color="danger" startDecorator={<ErrorIcon />} variant="soft">
                    <Box>
                        <Typography level="title-sm">Invalid License</Typography>
                        <Typography level="body-sm">
                            {status.validationStatus?.reason || 'License validation failed'}
                        </Typography>
                    </Box>
                </Alert>
            )}

            {/* License Status */}
            {status?.hasLicense && (
                <Card variant="outlined">
                    <CardContent>
                        <Stack spacing={2}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                    <CheckCircleIcon sx={{ fontSize: 20, color: 'success.main' }} />
                                    <Box>
                                        <Typography level="title-md">License Status</Typography>
                                        <Typography level="body-sm">Current license information and validation status</Typography>
                                    </Box>
                                </Box>
                                <Stack direction="row" spacing={1}>
                                    <Button
                                        size="sm"
                                        variant="outlined"
                                        startDecorator={<RefreshIcon />}
                                        onClick={handleRevalidate}
                                        loading={revalidating}
                                    >
                                        Revalidate
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="outlined"
                                        color="danger"
                                        startDecorator={<DeleteIcon />}
                                        onClick={handleDeactivate}
                                        loading={deactivating}
                                    >
                                        Remove
                                    </Button>
                                </Stack>
                            </Box>

                            <Divider />

                            <Stack spacing={1}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                        License Key:
                                    </Typography>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <Typography level="body-sm" fontFamily="monospace">
                                            {showKey ? (status.key || 'N/A') : `••••-••••-••••-${status.key?.slice(-4) || 'XXXX'}`}
                                        </Typography>
                                        <IconButton size="sm" variant="plain" onClick={() => setShowKey(!showKey)}>
                                            {showKey ? <VisibilityOffIcon /> : <VisibilityIcon />}
                                        </IconButton>
                                    </Box>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                        Status:
                                    </Typography>
                                    <Chip size="sm" variant="soft" color={getStatusColor()}>
                                        {getStatusText()}
                                    </Chip>
                                </Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                        Type:
                                    </Typography>
                                    {(status.type || status.tier) === 'trial' ? (
                                        <Chip size="sm" color="warning" variant="soft">TRIAL</Chip>
                                    ) : (
                                        <Chip size="sm" color="success" variant="soft">ENTERPRISE</Chip>
                                    )}
                                </Box>
                                {status.expiresAt && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                            Expires:
                                        </Typography>
                                        <Typography level="body-sm" fontWeight="lg" color={new Date(status.expiresAt) < new Date() ? 'danger' : 'neutral'}>
                                            {new Date(status.expiresAt).toLocaleDateString()}
                                        </Typography>
                                    </Box>
                                )}
                                {/* Subscription info is meaningful only for paid licenses */}
                                {(status.type || status.tier) !== 'trial' && (
                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <Typography level="body-sm" sx={{ color: 'text.secondary' }}>
                                            Subscription:
                                        </Typography>
                                        <Stack direction="row" spacing={1} alignItems="center">
                                            <Chip
                                                size="sm"
                                                variant="soft"
                                                color={status.subscriptionStatus === 'active' ? 'success' : 'danger'}
                                            >
                                                {status.subscriptionStatus === 'active' ? 'Active' : 'Cancelled'}
                                            </Chip>
                                            {status.subscriptionStatus === 'active' && (
                                                <Button
                                                    size="sm"
                                                    variant="plain"
                                                    onClick={handleManageSubscription}
                                                >
                                                    Manage
                                                </Button>
                                            )}
                                        </Stack>
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
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
            )}



            {/* Enterprise Features */}
            <Card variant="outlined">
                <CardContent>
                    <Stack spacing={2}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <InfoIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                            <Box>
                                <Typography level="title-md">Features Overview</Typography>
                                <Typography level="body-sm">Available features based on your license type</Typography>
                            </Box>
                        </Box>

                        <Divider />

                        <Stack spacing={1}>
                            <FeatureItemDetailed
                                label="Open Source Package Managers"
                                description="NPM and Raw file repository support"
                                enabled={true}
                                requiresLicense={false}
                            />
                            <FeatureItemDetailed
                                label="Enterprise Package Managers"
                                description="Maven, Docker, Helm, PyPI, NuGet, Rust, and Composer"
                                enabled={!!status?.isActive}
                                requiresLicense={true}
                            />
                            <FeatureItemDetailed
                                label="Enterprise Storage"
                                description="AWS S3, Google Cloud Storage, Azure Blob Storage"
                                enabled={!!status?.isActive}
                                requiresLicense={true}
                            />
                            <FeatureItemDetailed
                                label="Backup & Restore"
                                description="Create and restore system backups"
                                enabled={!!status?.isActive}
                                requiresLicense={true}
                            />
                            <FeatureItemDetailed
                                label="Advanced Security"
                                description="Enhanced authentication and authorization"
                                enabled={true}
                                requiresLicense={false}
                            />
                        </Stack>
                    </Stack>
                </CardContent>
            </Card>

            {/* Manual Activation / Update */}
            <Card variant="outlined">
                <CardContent>
                    <Stack spacing={2}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                            <VpnKeyIcon sx={{ fontSize: 20, color: 'primary.main' }} />
                            <Box>
                                <Typography level="title-md">
                                    {status?.hasLicense ? 'Update License' : 'Manual Activation'}
                                </Typography>
                                <Typography level="body-sm">
                                    {status?.hasLicense
                                        ? 'Enter a new license key to replace the current one'
                                        : 'Already purchased? Activate your license with the key received via email'}
                                </Typography>
                            </Box>
                        </Box>

                        <FormControl>
                            <FormLabel>License Key</FormLabel>
                            <Input
                                placeholder="DC-XXXX-XXXX-XXXX-XXXX"
                                value={licenseKey}
                                onChange={(e) => setLicenseKey(e.target.value)}
                                disabled={activating}
                                sx={{ fontFamily: 'monospace', fontSize: 'sm' }}
                            />
                        </FormControl>

                        <Button
                            onClick={handleActivate}
                            loading={activating}
                            disabled={!licenseKey.trim()}
                            sx={{ alignSelf: 'flex-start' }}
                        >
                            {status?.hasLicense ? 'Update License' : 'Activate License'}
                        </Button>
                    </Stack>
                </CardContent>
            </Card>

            {/* Info Alert */}
            {status?.hasLicense && (
                <Alert color="primary" startDecorator={<InfoIcon />} variant="soft">
                    <Box>
                        {(status.type || status.tier) === 'trial' ? (
                            <>
                                <Typography level="title-sm">Trial</Typography>
                                <Typography level="body-sm">{getTrialInfo(status.expiresAt) || 'Trial expires date not available'}</Typography>
                            </>
                        ) : (
                            <>
                                <Typography level="title-sm">Monthly Billing</Typography>
                                <Typography level="body-sm">
                                    Your license renews automatically every month. Manage your subscription and billing at the license portal.
                                </Typography>
                                {status.subscriptionStatus === 'active' && (
                                    <Button
                                        size="sm"
                                        variant="soft"
                                        color="primary"
                                        onClick={handleManageSubscription}
                                        sx={{ mt: 1.5 }}
                                        startDecorator={<ShoppingCartIcon />}
                                    >
                                        Manage Subscription
                                    </Button>
                                )}
                            </>
                        )}
                    </Box>
                </Alert>
            )}

            <ConfirmationModal
                open={confirmAction.open}
                onClose={() => setConfirmAction(prev => ({ ...prev, open: false }))}
                onConfirm={confirmAction.onConfirm}
                title={confirmAction.title}
                message={confirmAction.message}
                color={confirmAction.color}
            />
        </Stack>
    );
}

function FeatureItem({ label }: { label: string }) {
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
            <Typography level="body-sm">{label}</Typography>
        </Box>
    );
}

function FeatureItemDetailed({
    label,
    description,
    enabled,
    requiresLicense = false,
}: {
    label: string;
    description: string;
    enabled: boolean;
    requiresLicense?: boolean;
}) {
    return (
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                p: 1.5,
                borderRadius: 'sm',
                bgcolor: 'background.level1',
            }}
        >
            <Box sx={{ flex: 1 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography level="title-sm">{label}</Typography>
                    {requiresLicense && (
                        <Chip size="sm" variant="outlined" color="warning">
                            Requires License
                        </Chip>
                    )}
                </Box>
                <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
                    {description}
                </Typography>
            </Box>
            <Chip
                size="sm"
                variant="soft"
                color={enabled ? 'success' : 'neutral'}
                startDecorator={enabled ? <CheckCircleIcon /> : undefined}
            >
                {enabled ? 'Enabled' : 'Disabled'}
            </Chip>
        </Box>
    );
}
