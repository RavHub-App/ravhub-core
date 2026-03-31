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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FilesystemStorageAdapter } from '../../storage/filesystem-storage.adapter';
import { RedlockService } from '../redis/redlock.service';
import { Readable } from 'stream';
import {
  StorageAdapterRegistry,
  type StorageAdapter,
} from './storage-adapter-registry';
import { StorageConfigResolver } from './storage-config-resolver';

const MIGRATION_LOCK_TTL = 3600000;

const logger = new Logger('StorageService');

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly configResolver = new StorageConfigResolver();
  private readonly adapterRegistry = new StorageAdapterRegistry(
    this.configResolver,
  );
  private smallFilesCache: Map<string, { data: Buffer; expires: number }> =
    new Map();

  constructor(private readonly redlock: RedlockService) { }

  async onModuleInit() {
    this.configResolver.clear();
    await this.adapterRegistry.initialize();
  }

  private async getAdapterForKey(key: string): Promise<StorageAdapter> {
    return this.adapterRegistry.getAdapterForKey(key);
  }

  async save(key: string, data: Buffer | string) {
    this.smallFilesCache.delete(key);
    const adapter = await this.getAdapterForKey(key);
    return adapter.save(key, data);
  }

  async saveStream(key: string, stream: Readable) {
    this.smallFilesCache.delete(key);
    const adapter = await this.getAdapterForKey(key);
    if (adapter.saveStream) {
      return adapter.saveStream(key, stream);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk);
        continue;
      }

      chunks.push(
        chunk instanceof Uint8Array
          ? Buffer.from(chunk)
          : Buffer.from(String(chunk)),
      );
    }
    return adapter.save(key, Buffer.concat(chunks));
  }

  async getUrl(key: string) {
    const adapter = await this.getAdapterForKey(key);
    return adapter.getUrl(key);
  }

  async exists(key: string) {
    const adapter = await this.getAdapterForKey(key);
    return adapter.exists(key);
  }

  async delete(key: string) {
    this.smallFilesCache.delete(key); // Invalidate cache
    const adapter = await this.getAdapterForKey(key);
    return adapter.delete(key);
  }

  async get(key: string): Promise<Buffer | null> {
    const cached = this.smallFilesCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const adapter = await this.getAdapterForKey(key);
    const data = await adapter.get(key);

    if (data && data.length < 1024 * 1024) {
      this.smallFilesCache.set(key, {
        data,
        expires: Date.now() + 5000,
      });
    }
    return data;
  }

  async list(prefix: string): Promise<string[]> {
    const adapter = await this.getAdapterForKey(prefix);
    return adapter.list?.(prefix) ?? [];
  }

  async getMetadata(key: string) {
    const adapter = await this.getAdapterForKey(key);
    return adapter.getMetadata?.(key) ?? null;
  }

  async getStream(key: string, range?: { start?: number; end?: number }) {
    const adapter = await this.getAdapterForKey(key);

    if (adapter.getStream) {
      return adapter.getStream(key, range);
    }

    const url = await adapter.getUrl(key);
    if (url?.startsWith('file://')) {
      const fp = url.replace(/^file:\/\//, '');
      const fsAdapter =
        this.adapterRegistry.getDefaultAdapter() as FilesystemStorageAdapter;
      if (fsAdapter?.getStream) {
        return fsAdapter.getStream(fp, range);
      }
    }
    throw new Error('Stream not supported for this adapter');
  }

  async getAdapterForId(storageId: string | null): Promise<StorageAdapter> {
    return this.adapterRegistry.getAdapterForId(storageId);
  }

  async getDefaultStorageConfig() {
    return this.configResolver.getDefaultStorageConfig();
  }

  async migrate(
    prefix: string,
    oldStorageId: string | null,
    newStorageId: string | null,
  ) {
    if (oldStorageId === newStorageId) return;

    const lockKey = `migrate:${prefix}:${oldStorageId || 'def'}:${newStorageId || 'def'}`;

    return this.redlock.runWithLock(lockKey, MIGRATION_LOCK_TTL, async () => {
      logger.log(
        `Migrating ${prefix} from ${oldStorageId || 'default'} to ${newStorageId || 'default'}`,
      );

      const source = await this.getAdapterForId(oldStorageId);
      const dest = await this.getAdapterForId(newStorageId);

      const files = (await source.list?.(prefix)) ?? [];

      if (files.length === 0) {
        logger.log(`No files found to migrate for prefix ${prefix}`);
        return;
      }

      logger.log(`Found ${files.length} files to migrate for ${prefix}`);

      for (const file of files) {
        try {
          if (source.getStream && dest.saveStream) {
            const result = await source.getStream(file);
            if (result && result.stream) {
              await dest.saveStream(file, result.stream);
              logger.debug(`Migrated (stream) ${file}`);
            }
          } else {
            const content = await source.get(file);
            if (content) {
              await dest.save(file, content);
              logger.debug(`Migrated (buffer) ${file}`);
            }
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          logger.error(`Failed to migrate file ${file}: ${errorMessage}`);
        }
      }

      logger.log(`Migration of ${prefix} completed.`);
    });
  }
}
