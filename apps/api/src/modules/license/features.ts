/**
 * Enterprise Features Configuration
 * 
 * This file defines which features are available in Community vs Enterprise editions.
 * Used by LicenseService and related services to enforce licensing.
 */

/**
 * Features available in the free Community Edition.
 * These work without any license.
 */
export const COMMUNITY_FEATURES = [
    // Package Managers
    'npm',
    'pypi',
    'docker',
    'maven',

    // Storage
    'storage.filesystem',

    // Basic features
    'repositories.hosted',
    'repositories.proxy',
    'repositories.group',
] as const;

/**
 * Features that require an Enterprise license.
 */
export const ENTERPRISE_FEATURES = [
    // Additional Package Managers
    'nuget',
    'composer',
    'helm',
    'rust',
    'raw',

    // Enterprise Storage Backends
    'storage.s3',
    'storage.gcs',
    'storage.azure',

    // Enterprise Features
    'backup',
    'backup.scheduled',
    'backup.restore',
    'cleanup.policies',
    'audit.export',
    'ha.redis',       // High Availability with Redis clustering
    'rbac.advanced',  // Advanced RBAC features beyond basic roles
] as const;

/**
 * All available features
 */
export const ALL_FEATURES = [...COMMUNITY_FEATURES, ...ENTERPRISE_FEATURES] as const;

/**
 * Feature categories for UI display
 */
export const FEATURE_CATEGORIES = {
    'Package Managers': {
        community: ['npm', 'pypi', 'docker', 'maven'],
        enterprise: ['nuget', 'composer', 'helm', 'rust', 'raw'],
    },
    'Storage Backends': {
        community: ['storage.filesystem'],
        enterprise: ['storage.s3', 'storage.gcs', 'storage.azure'],
    },
    'Backup & Recovery': {
        community: [],
        enterprise: ['backup', 'backup.scheduled', 'backup.restore'],
    },
    'Administration': {
        community: [],
        enterprise: ['cleanup.policies', 'audit.export', 'rbac.advanced'],
    },
    'High Availability': {
        community: [],
        enterprise: ['ha.redis'],
    },
} as const;

export type CommunityFeature = typeof COMMUNITY_FEATURES[number];
export type EnterpriseFeature = typeof ENTERPRISE_FEATURES[number];
export type Feature = CommunityFeature | EnterpriseFeature;

/**
 * Check if a feature is available in Community Edition
 */
export function isCommunityFeature(feature: string): boolean {
    return COMMUNITY_FEATURES.includes(feature as CommunityFeature);
}

/**
 * Check if a feature requires Enterprise license
 */
export function isEnterpriseFeature(feature: string): boolean {
    return ENTERPRISE_FEATURES.includes(feature as EnterpriseFeature);
}
