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

import { ForbiddenException } from '@nestjs/common';
import type { SaveResult } from '../../storage/storage.interface';
import { Readable } from 'stream';
import type { StorageAdapter } from './storage-adapter-registry';

const STORAGE_TYPE = {
  S3: 's3',
  GCS: 'gcs',
  AZURE: 'azure',
  FILESYSTEM: 'filesystem',
} as const;

const ENTERPRISE_STORAGE_TYPES = [
  STORAGE_TYPE.S3,
  STORAGE_TYPE.GCS,
  STORAGE_TYPE.AZURE,
];

export const DEFAULT_ADAPTER_KEY = 'fs-default';
export { STORAGE_TYPE };

export function isEnterpriseStorageType(
  type: string,
): type is (typeof ENTERPRISE_STORAGE_TYPES)[number] {
  return ENTERPRISE_STORAGE_TYPES.some((candidate) => candidate === type);
}

export class ReadOnlyStorageWrapper implements StorageAdapter {
  constructor(
    private readonly adapter: StorageAdapter,
    private readonly storageType: string,
  ) {}

  async get(key: string): Promise<Buffer | null> {
    return this.adapter.get(key);
  }

  async getStream(key: string, range?: { start?: number; end?: number }) {
    return this.adapter.getStream(key, range);
  }

  async exists(key: string): Promise<boolean> {
    return this.adapter.exists(key);
  }

  async getUrl(key: string): Promise<string> {
    return this.adapter.getUrl(key);
  }

  async list(prefix: string): Promise<string[]> {
    return this.adapter.list?.(prefix) ?? [];
  }

  async getMetadata(
    key: string,
  ): Promise<{ size: number; mtime: Date } | null> {
    return (await this.adapter.getMetadata?.(key)) ?? null;
  }

  async save(_key: string, _data: Buffer | string): Promise<SaveResult> {
    this.throwLicenseError('write to');
  }

  async saveStream(_key: string, _stream: Readable): Promise<SaveResult> {
    this.throwLicenseError('write to');
  }

  async delete(_key: string): Promise<boolean> {
    this.throwLicenseError('delete from');
  }

  private throwLicenseError(action: string): never {
    throw new ForbiddenException(
      `Cannot ${action} ${this.storageType} storage: Enterprise license required. ` +
        `Your existing data is still accessible in read-only mode. ` +
        `Please renew your license to enable write operations.`,
    );
  }
}
