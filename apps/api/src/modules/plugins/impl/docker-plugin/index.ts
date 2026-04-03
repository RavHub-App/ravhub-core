/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

/**
 * Docker Plugin - Modular Entry Point
 *
 * This file wires together all the extracted modules into a cohesive plugin.
 * The plugin supports Docker Registry V2 API with hosted, proxy, and group repository types.
 *
 * Directory structure:
 * - config/     - JSON Schema configuration for UI
 * - auth/       - Authentication (JWT tokens)
 * - utils/      - Shared helpers and types
 * - storage/    - Upload, download, manifest operations
 * - proxy/      - Upstream registry fetching
 * - packages/   - Package listing and metadata
 * - registry/   - In-process HTTP registry server
 */

import { buildKey } from './utils/key-utils';

// Configuration
import { configSchema as dockerConfigSchema } from './config/schema';

// Authentication
import { issueToken, authenticate, generateToken } from './auth/auth';

// Utils
import { normalizeImageName, uploads, uploadTargets } from './utils/helpers';
import type { Repository, PluginContext } from './utils/types';

// Storage operations
import {
  initUpload,
  initiateUpload,
  appendUpload,
  finalizeUpload,
} from './storage/upload';
import { initDownload, download, getBlob } from './storage/download';
import {
  initManifest,
  putManifest,
  deleteManifest,
  deletePackageVersion,
} from './storage/manifest';

// Proxy
import { initProxyFetch, proxyFetch, pingUpstream } from './proxy/fetch';

// Packages
import {
  initPackages,
  listPackages,
  getPackage,
  listVersions,
  getInstallCommand,
} from './packages/list';

// Registry server
import {
  startRegistryForRepo,
  stopRegistryForRepo,
  getRegistryServers,
} from './registry/server';
import {
  createArtifactIndexer,
  createDownloadTracker,
  createRegistryStarter,
  createRepoResolver,
  createTokenRequestHandler,
  createUploadTracker,
} from './plugin-support';

/**
 * Initialize the plugin with context
 */
export function createDockerPlugin(context: PluginContext) {
  const { storage, redis } = context;
  const getRepo = createRepoResolver(context);
  const indexArtifact = createArtifactIndexer(context);
  const trackDownload = createDownloadTracker(context);
  const trackUpload = createUploadTracker(context);
  const handleTokenRequest = createTokenRequestHandler();

  // Initialize all modules with their dependencies
  initProxyFetch({ ...context, indexArtifact });
  initUpload({ storage, getRepo, redis, trackUpload });
  initDownload({ storage, proxyFetch, getRepo });
  initManifest({ storage, getRepo, getBlob, proxyFetch, indexArtifact });
  initPackages({ storage, getRepo, proxyFetch });

  // Build the plugin object
  const plugin = {
    // Metadata
    id: 'docker',
    name: 'Docker Registry',
    description:
      'Docker Registry V2 API with support for hosted, proxy, and group repositories',

    // Configuration schema for UI
    configSchema: dockerConfigSchema,

    // Repository types
    supportedTypes: ['hosted', 'proxy', 'group'],

    // Authentication methods
    issueToken,
    authenticate,
    generateToken,

    // Storage operations
    initiateUpload,
    appendUpload,
    finalizeUpload,
    download,
    getBlob,
    putManifest,
    deleteManifest,
    deletePackageVersion,

    // Package operations
    listPackages,
    getPackage,
    listVersions,
    getInstallCommand,

    // Registry server
    startRegistryForRepo: async (repo: Repository, opts?: any) =>
      createRegistryStarter(getRepo, startRegistryForRepo)(repo, plugin, opts),
    stopRegistryForRepo,

    // Handle HTTP requests proxied from the registry server
    request: handleTokenRequest,

    // Internal state
    _registryServers: getRegistryServers(),

    // Helper methods exposed for registry server
    proxyFetch,
    // Ping upstream/proxy target to check reachability
    pingUpstream,
    trackDownload,
    trackUpload,
    getRepo,
    indexArtifact,

    // Utilities
    normalizeImageName,
    uploads,
    uploadTargets,
  };

  return plugin;
}

/**
 * Default export for plugin loader
 */
const defaultExport: any = {
  metadata: {
    key: 'docker',
    name: 'Docker Registry',
    description: 'Docker Registry V2 plugin',
    configSchema: dockerConfigSchema,
    requiresLicense: true,
    licenseType: 'enterprise',
  },
  // Placeholder method to pass conformance check before init
  authenticate: () => ({ ok: false, message: 'Plugin not initialized' }),
  init: async (context: any) => {
    const plugin = createDockerPlugin(context);
    (plugin as any).metadata = defaultExport.metadata;
    // Copy all methods to defaultExport so they're accessible
    Object.assign(defaultExport, plugin);
    return defaultExport;
  },
};
export default defaultExport;

/**
 * Named exports for individual modules (optional, for advanced usage)
 */
export {
  // Configuration
  dockerConfigSchema,

  // Auth
  issueToken,
  authenticate,
  generateToken,

  // Storage
  initiateUpload,
  appendUpload,
  finalizeUpload,
  download,
  getBlob,
  putManifest,
  deleteManifest,
  deletePackageVersion,

  // Packages
  listPackages,
  getPackage,
  listVersions,
  getInstallCommand,

  // Registry
  startRegistryForRepo,
  stopRegistryForRepo,
  // Proxy
  pingUpstream,

  // Utils
  normalizeImageName,

  // Types
  type Repository,
  type PluginContext,
};
