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
