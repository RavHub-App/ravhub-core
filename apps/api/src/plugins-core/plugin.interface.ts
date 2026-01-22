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

export interface PluginMetadata {
  key: string;
  name?: string;
  description?: string;
  requiresLicense?: boolean;
  licenseType?: string;
  icon?: string;
  configSchema?: any;
}

export interface UploadResult {
  ok: boolean;
  id?: string;
  message?: string;
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
    getMetadata?(key: string): Promise<{ size: number; mtime: Date } | null>;
  };
  getRepo?: (id: string) => Promise<Repository | null>;
  indexArtifact?: (
    repo: Repository,
    result: any,
    userId?: string,
  ) => Promise<void>;
  redis?: any;
}

export interface DownloadResult {
  ok: boolean;
  url?: string;
  message?: string;
  data?: any;
  body?: any;
  contentType?: string;
  storageKey?: string;
  size?: number;
}

export interface ListVersionsResult {
  ok: boolean;
  versions?: string[];
  message?: string;
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
  init?(opts?: any): Promise<void>;
  ping?(): Promise<any>;
  upload?(repo: any, pkg: any): Promise<UploadResult>;
  download?(
    repo: any,
    packageName: string,
    version?: string,
  ): Promise<DownloadResult>;
  listVersions?(repo: any, packageName: string): Promise<ListVersionsResult>;
  proxyFetch?(repo: any, url: string): Promise<ProxyFetchResult>;
  authenticate?(
    repo: any,
    credentials: any,
  ): Promise<{ ok: boolean; user?: any; token?: string; message?: string }>;

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

  stopRegistryForRepo?: (repo: any) => Promise<{
    ok: boolean;
    message?: string;
  }>;

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
  handlePut?(repo: any, path: string, req: any): Promise<any>;
  pingUpstream?(repo: any, context: PluginContext): Promise<any>;
  getInstallCommand?(
    repo: any,
    pkg: { name: string; version: string },
  ): Promise<string | InstallInstruction[]>;
}

export type PluginModule = IPlugin | { default: IPlugin };
