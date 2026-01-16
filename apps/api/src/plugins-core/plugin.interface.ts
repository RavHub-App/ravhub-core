export interface PluginMetadata {
  key: string;
  name?: string;
  description?: string;
  version?: string;
  requiresLicense?: boolean;
  /** Optional specific license type required, usually 'enterprise' */
  licenseType?: string;
  /** Optional public URL (path) to an icon image for this plugin, e.g. '/plugins/npm/icon' */
  icon?: string;
  /** Optional configuration schema (JSON Schema-ish) advertised by the plugin so the host UI
   * can render dynamic configuration forms. Plugins don't have to provide this.
   */
  configSchema?: any;
}

export function resolvePluginVersion(currentDir: string): string {
  return '1.0.0'; // Built-in default version
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  message?: string;
  // optional metadata provided by plugin for indexing (storage key, package/version)
  metadata?: {
    storageKey?: string;
    name?: string;
    version?: string;
    size?: number;
    [k: string]: any;
  };
}

export interface Repository {
  id: string;
  name: string;
  type: string;
  manager: string;
  config?: any;
}

export interface PluginContext {
  storage: {
    save(key: string, data: Buffer | string): Promise<any>;
    saveStream?(key: string, stream: any): Promise<any>;
    get(key: string): Promise<Buffer | null>;
    getStream?(key: string, range?: any): Promise<any>;
    exists(key: string): Promise<boolean>;
    delete(key: string): Promise<boolean>;
    getUrl(key: string): Promise<string>;
    list(prefix: string): Promise<string[]>;
  };
  dataSource?: any;
  getRepo?: (id: string) => Promise<Repository | null>;
  trackDownload?: (
    repo: Repository,
    name: string,
    version?: string,
  ) => Promise<void>;
  indexArtifact?: (repo: Repository, result: any, userId?: string) => Promise<void>;
  redis?: any;
}

export interface DownloadResult {
  ok: boolean;
  // For demo: url or buffer can be provided - production would stream
  url?: string;
  message?: string;
  data?: any;
  contentType?: string;
}

export interface ListVersionsResult {
  ok: boolean;
  versions: string[];
}

export interface InstallInstruction {
  label: string;
  command: string;
  language: string;
}

export interface ProxyFetchResult {
  ok: boolean;
  status: number;
  body?: any;
  skipCache?: boolean;
}

export interface IPlugin {
  metadata: PluginMetadata;
  // Called once when plugin is loaded by the host
  init?(opts?: any): Promise<void>;

  // Basic health / ping endpoint that returns plugin-specific metadata
  ping?(): Promise<any>;

  // Plugin storage / protocol methods - allow the host to call
  upload?(repo: any, pkg: any): Promise<UploadResult>;
  download?(
    repo: any,
    packageName: string,
    version?: string,
  ): Promise<DownloadResult>;
  listVersions?(repo: any, packageName: string): Promise<ListVersionsResult>;
  proxyFetch?(repo: any, url: string): Promise<ProxyFetchResult>;
  // plugin-specific authentication flow (e.g. npm login, docker login)
  authenticate?(
    repo: any,
    credentials: any,
  ): Promise<{ ok: boolean; user?: any; token?: string; message?: string }>;

  // Optional Docker-specific operations (plugins that implement Docker responsibilities
  // may implement the multipart and token flows themselves). The API controller delegates
  // to these if they exist so plugin can fully encapsulate behavior.
  generateToken?(
    repo: any,
    credentials?: any,
    options?: any,
  ): Promise<{
    ok: boolean;
    token?: string;
    expires_in?: number;
    message?: string;
    user?: any;
  }>;

  // (Docker helpers such as uploads/blobs/manifests are declared below once)

  // Optional Docker-specific helpers (plugins may implement to take full ownership
  // of registry flows for blobs/manifests + token lifecycle). These are optional
  // so other plugins are unaffected.
  // Start a registry process for a specific repository (optional); plugin may
  // return { ok, port } to indicate a running per-repo registry.
  startRegistryForRepo?: (
    repo: any,
    opts?: any,
  ) => Promise<{
    ok: boolean;
    port?: number;
    accessUrl?: string;
    host?: string;
    message?: string;
  }>;
  // Stop a registry process for a specific repository (optional); plugin may
  // close the running per-repo registry and cleanup resources.
  stopRegistryForRepo?: (repo: any) => Promise<{
    ok: boolean;
    message?: string;
  }>;

  // Multipart blob helpers for Docker (the plugin may implement full multi-step uploads)
  initiateUpload?: (
    repo: any,
    name: string,
  ) => Promise<{
    ok: boolean;
    uuid?: string;
    location?: string;
    message?: string;
  }>;
  appendUpload?: (
    repo: any,
    name: string,
    uuid: string,
    chunk: Buffer,
  ) => Promise<{ ok: boolean; uploaded?: number; message?: string }>;
  finalizeUpload?: (
    repo: any,
    name: string,
    uuid: string,
    digest?: string,
    blob?: Buffer,
  ) => Promise<UploadResult>;
  getBlob?: (
    repo: any,
    name: string,
    digest: string,
  ) => Promise<DownloadResult>;
  putManifest?: (
    repo: any,
    name: string,
    tag: string,
    manifest: any,
  ) => Promise<UploadResult>;
  // token server helper: produce token payloads that registry clients expect
  issueToken?: (
    repo: any,
    credentials: any,
  ) => Promise<{
    ok: boolean;
    token?: string;
    access_token?: string;
    expires_in?: number;
    message?: string;
  }>;

  // Called to handle a PUT request (e.g. for raw file upload)
  handlePut?(repo: any, path: string, req: any): Promise<any>;

  pingUpstream?(repo: any, context: PluginContext): Promise<any>;

  getInstallCommand?(
    repo: any,
    pkg: { name: string; version: string },
  ): Promise<string | InstallInstruction[]>;
}

export type PluginModule = IPlugin | { default: IPlugin };
