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

/**
 * Initialize the plugin with context
 */
export function createDockerPlugin(context: PluginContext) {
  const { storage, redis } = context;

  // Helper to get repository by ID (needed for group operations)
  // Prefer host-provided resolver (DB-backed). Fallback to storage only if provided.
  const fallbackGetRepo = async (
    repoId: string,
  ): Promise<Repository | null> => {
    try {
      if (!storage?.get) return null;
      const key = buildKey('repository', repoId, 'metadata');
      const data = await storage.get(key);
      if (!data) return null;
      return JSON.parse(data.toString('utf8'));
    } catch (err) {
      console.error('[GET REPO ERROR]', err);
      return null;
    }
  };

  const getRepo: (repoId: string) => Promise<Repository | null> = async (
    repoId: string,
  ) => {
    const r = context.getRepo
      ? await context.getRepo(repoId)
      : await fallbackGetRepo(repoId);
    return (r as any) ?? null;
  };

  // Helper to index artifacts for search
  const indexArtifact = async (
    repo: Repository,
    nameOrResult: string | any,
    tagOrUserId?: string,
    metadata?: any,
    userId?: string,
  ) => {
    try {
      let name: string;
      let tag: string;
      let finalMetadata: any;
      let finalUserId: string | undefined;

      if (typeof nameOrResult === 'object' && nameOrResult !== null) {
        // Object signature: (repo, result, userId)
        const result = nameOrResult;
        finalUserId = tagOrUserId;
        finalMetadata = result.metadata || {};
        name = finalMetadata.name || result.id?.split(':')[0] || 'unknown';
        tag = finalMetadata.version || result.id?.split(':')[1] || 'latest';
      } else {
        // Positional signature: (repo, name, tag, metadata, userId)
        name = nameOrResult;
        tag = tagOrUserId || 'latest';
        finalMetadata = metadata || {};
        finalUserId = userId;
      }

      const key = buildKey('artifact', repo.id, 'index', name, tag);
      await storage.save(
        key,
        Buffer.from(
          JSON.stringify({
            name,
            tag,
            repository: repo.name,
            repositoryId: repo.id,
            indexed: new Date().toISOString(),
            ...finalMetadata,
          }),
        ),
      );

      // Also index in main DB if context provides the helper
      if (context.indexArtifact) {
        await context.indexArtifact(
          repo,
          {
            ok: true,
            id: `${name}:${tag}`,
            metadata: {
              name,
              storageKey: key,
              ...finalMetadata,
            },
          },
          finalUserId,
        );
      }
    } catch (err) {
      console.error('[INDEX ARTIFACT ERROR]', err);
    }
  };

  // Helper to track downloads for analytics
  const trackDownload = async (repo: Repository, name: string, tag: string) => {
    try {
      const key = buildKey(
        'stats',
        repo.id,
        'downloads',
        name,
        tag,
        Date.now().toString(),
      );
      await storage.save(
        key,
        Buffer.from(
          JSON.stringify({
            name,
            tag,
            repository: repo.name,
            repositoryId: repo.id,
            timestamp: new Date().toISOString(),
          }),
        ),
      );
    } catch (err) {
      console.error('[TRACK DOWNLOAD ERROR]', err);
    }
  };

  // Initialize all modules with their dependencies
  initProxyFetch({ ...context, indexArtifact });
  initUpload({ storage, getRepo, redis });
  initDownload({ storage, proxyFetch, getRepo });
  initManifest({ storage, getRepo, getBlob, proxyFetch, indexArtifact });
  initPackages({ storage, getRepo });

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
    startRegistryForRepo: async (repo: Repository, opts?: any) => {
      // Build reposById map for group resolution if not provided
      if (!opts?.reposById && repo.type === 'group') {
        const reposById = new Map<string, Repository>();
        const members: string[] = repo.config?.members ?? [];
        for (const memberId of members) {
          const memberRepo = await getRepo(memberId);
          if (memberRepo) {
            reposById.set(memberId, memberRepo);
          }
        }
        opts = { ...opts, reposById };
      }

      return startRegistryForRepo(repo, opts, { plugin });
    },
    stopRegistryForRepo,

    // Handle HTTP requests proxied from the registry server
    request: async (context: PluginContext, request: any) => {
      const { path, query } = request;

      // Handle /v2/token
      if (path === '/v2/token') {
        try {
          const jwt = require('jsonwebtoken');
          const secret = process.env.JWT_SECRET;

          if (!secret) {
            console.error('[DOCKER PLUGIN] JWT_SECRET not configured');
            return { status: 500, body: { error: 'server misconfigured' } };
          }

          const scope = query.scope as string;
          const service = query.service as string;

          const access: any[] = [];
          if (scope) {
            // scope format: repository:name:action
            const parts = scope.split(':');
            if (parts.length === 3 && parts[0] === 'repository') {
              access.push({
                type: 'repository',
                name: parts[1],
                actions: parts[2].split(','),
              });
            }
          }

          const token = jwt.sign(
            {
              iss: 'distributed-package-registry',
              sub: 'admin', // In a real scenario, use context.user.username
              aud: service,
              exp: Math.floor(Date.now() / 1000) + 3600,
              nbf: Math.floor(Date.now() / 1000) - 60,
              iat: Math.floor(Date.now() / 1000),
              jti: Math.random().toString(36).substring(2),
              access: access,
            },
            secret,
          );

          return {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
            body: { token },
          };
        } catch (err: any) {
          console.error('[DOCKER PLUGIN] Token generation failed:', err);
          return { status: 500, body: { error: err.message } };
        }
      }

      return { status: 404, body: { error: 'Not found' } };
    },

    // Internal state
    _registryServers: getRegistryServers(),

    // Helper methods exposed for registry server
    proxyFetch,
    // Ping upstream/proxy target to check reachability
    pingUpstream,
    trackDownload,
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
