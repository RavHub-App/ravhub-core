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

export const COMMUNITY_FEATURES = [
  'npm',
  'pypi',
  'docker',
  'maven',
  'nuget',
  'composer',
  'helm',
  'rust',
  'raw',
  'storage.filesystem',
  'repositories.hosted',
  'repositories.proxy',
  'repositories.group',
  'cleanup.policies',
  'audit.export',
] as const;

export const ENTERPRISE_FEATURES = [
  'storage.s3',
  'storage.gcs',
  'storage.azure',
  'backup',
  'backup.scheduled',
  'backup.restore',
] as const;

export const ALL_FEATURES = [
  ...COMMUNITY_FEATURES,
  ...ENTERPRISE_FEATURES,
] as const;

export const FEATURE_CATEGORIES = {
  'Package Managers': {
    community: [
      'npm',
      'pypi',
      'docker',
      'maven',
      'nuget',
      'composer',
      'helm',
      'rust',
      'raw',
    ],
    enterprise: [],
  },
  'Storage Backends': {
    community: ['storage.filesystem'],
    enterprise: ['storage.s3', 'storage.gcs', 'storage.azure'],
  },
  'Backup & Recovery': {
    community: [],
    enterprise: ['backup', 'backup.scheduled', 'backup.restore'],
  },
  Administration: {
    community: ['cleanup.policies', 'audit.export'],
    enterprise: [],
  },
} as const;

export type CommunityFeature = (typeof COMMUNITY_FEATURES)[number];
export type EnterpriseFeature = (typeof ENTERPRISE_FEATURES)[number];
export type Feature = CommunityFeature | EnterpriseFeature;

export function isCommunityFeature(feature: string): boolean {
  return COMMUNITY_FEATURES.includes(feature as CommunityFeature);
}

export function isEnterpriseFeature(feature: string): boolean {
  return ENTERPRISE_FEATURES.includes(feature as EnterpriseFeature);
}
