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

export type StorageType = 'filesystem' | 's3' | 'gcs' | 'azure';

export interface FilesystemConfig {
  basePath?: string;
}

export interface S3Config {
  bucket: string;
  region?: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  emulateLocal?: boolean;
  basePath?: string;
}

export interface GcsConfig {
  bucket: string;
  projectId?: string;
  credentials?: any;
  emulateLocal?: boolean;
  basePath?: string;
}

export interface AzureConfig {
  container: string;
  connectionString?: string;
  emulateLocal?: boolean;
  basePath?: string;
}

export interface StorageConfigDto {
  key: string;
  type: StorageType;
  config?:
    | FilesystemConfig
    | S3Config
    | GcsConfig
    | AzureConfig
    | Record<string, any>;
  isDefault?: boolean;
}
