export type { PluginContext } from '../../../../../plugins-core/plugin.interface';
/**
 * Shared TypeScript types for Docker plugin
 */

/**
 * Plugin context provided during initialization
 */


/**
 * Repository entity (simplified interface)
 */
export interface Repository {
  id: string;
  name: string;
  type: 'hosted' | 'proxy' | 'group';
  manager: string;
  config?: {
    docker?: DockerConfig;
    members?: string[];
    writePolicy?: 'none' | 'preferred' | 'first';
    preferredWriter?: string;
    target?: string;
    registry?: string;
    upstream?: string;
    auth?: AuthConfig;
    cacheTtlSeconds?: number;
    cacheMaxAgeDays?: number;
    [key: string]: any;
  };
  accessUrl?: string;
}

/**
 * Docker-specific configuration
 */
export interface DockerConfig {
  version?: 'v1' | 'v2';
  port?: number;
  proxyUrl?: string;
  upstream?: string;
  isDockerHub?: boolean;
  libraryPrefix?: 'auto' | 'enabled' | 'disabled';
  requireAuth?: boolean;
  auth?: AuthConfig;
  allowRedeploy?: boolean;
}

/**
 * Authentication configuration
 */
export interface AuthConfig {
  type?: 'basic' | 'bearer' | 'none';
  username?: string;
  password?: string;
  token?: string;
}

/**
 * Upload session state
 */
export interface UploadSession {
  uuid: string;
  chunks: Buffer[];
  totalSize: number;
  startedAt: number;
}

/**
 * Plugin result types
 */
export interface PluginResult<T = any> {
  ok: boolean;
  message?: string;
  data?: T;
  [key: string]: any;
}

/**
 * Manifest metadata
 */
export interface ManifestMetadata {
  schemaVersion?: number;
  mediaType?: string;
  config?: {
    digest: string;
    size?: number;
    mediaType?: string;
  };
  layers?: Array<{
    digest: string;
    size?: number;
    mediaType?: string;
  }>;
  manifests?: Array<{
    digest: string;
    size?: number;
    mediaType?: string;
    platform?: {
      architecture?: string;
      os?: string;
    };
  }>;
}

/**
 * Package metadata
 */
export interface PackageMetadata {
  name: string;
  version: string;
  type?: string;
  size?: number;
  storageKey?: string;
  digest?: string;
  [key: string]: any;
}
