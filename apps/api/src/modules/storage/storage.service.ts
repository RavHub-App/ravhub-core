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

import {
  Injectable,
  Logger,
  ForbiddenException,
  OnModuleInit,
} from '@nestjs/common';
import AppDataSource from '../../data-source';
import { tryNormalizeRepoNames } from '../../storage/key-utils';
import { FilesystemStorageAdapter } from '../../storage/filesystem-storage.adapter';
import { StorageConfig } from '../../entities/storage-config.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { RedlockService } from '../redis/redlock.service';
import { Readable } from 'stream';

// Constants for Storage Types
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
const DEFAULT_ADAPTER_KEY = 'fs-default';
const MIGRATION_LOCK_TTL = 3600000; // 1 hour

interface StorageAdapter {
  get(key: string): Promise<Buffer | null>;
  getStream(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{ stream: Readable; length?: number } | null>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
  list?(prefix: string): Promise<string[]>;
  getMetadata?(key: string): Promise<{ size: number; mtime: Date } | null>;
  save(key: string, data: Buffer | string): Promise<void>;
  saveStream?(key: string, stream: Readable): Promise<void>;
  delete(key: string): Promise<void>;
}

type AdapterEntry = {
  id: string | typeof DEFAULT_ADAPTER_KEY;
  type: string;
  instance: StorageAdapter;
  readOnly?: boolean;
};

const logger = new Logger('StorageService');

class ReadOnlyStorageWrapper implements StorageAdapter {
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

  async save(key: string, data: Buffer | string): Promise<void> {
    this.throwReadOnlyError();
  }

  async saveStream(key: string, stream: Readable): Promise<void> {
    this.throwReadOnlyError();
  }

  async delete(key: string): Promise<void> {
    this.throwLicenseError('delete from');
  }

  private throwReadOnlyError() {
    this.throwLicenseError('write to');
  }

  private throwLicenseError(action: string) {
    throw new ForbiddenException(
      `Cannot ${action} ${this.storageType} storage: Enterprise license required. ` +
        `Your existing data is still accessible in read-only mode. ` +
        `Please renew your license to enable write operations.`,
    );
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  private adapters: Map<string, AdapterEntry> = new Map();
  private repoStorageIdCache: Map<string, string | null> = new Map();
  private storageConfigCache: Map<string, StorageConfig> = new Map();
  private smallFilesCache: Map<string, { data: Buffer; expires: number }> =
    new Map();

  constructor(private readonly redlock: RedlockService) {}

  async onModuleInit() {
    this.adapters.clear();
    await this.configureDefaultAdapter();
  }

  private async configureDefaultAdapter() {
    const {
      STORAGE_TYPE: envType,
      S3_BUCKET,
      GCS_BUCKET,
      AZURE_CONTAINER,
    } = process.env;

    if (envType === STORAGE_TYPE.S3 || S3_BUCKET) {
      await this.initDefaultEnterpriseAdapter(
        STORAGE_TYPE.S3,
        {
          bucket: S3_BUCKET,
          region: process.env.S3_REGION,
          accessKey: process.env.S3_ACCESS_KEY,
          secretKey: process.env.S3_SECRET_KEY,
          endpoint: process.env.S3_ENDPOINT,
          s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
        },
        `Bucket: ${S3_BUCKET}`,
      );
    } else if (envType === STORAGE_TYPE.GCS || GCS_BUCKET) {
      await this.initDefaultEnterpriseAdapter(
        STORAGE_TYPE.GCS,
        {},
        `Bucket: ${GCS_BUCKET}`,
      );
    } else if (envType === STORAGE_TYPE.AZURE || AZURE_CONTAINER) {
      await this.initDefaultEnterpriseAdapter(
        STORAGE_TYPE.AZURE,
        {},
        `Container: ${AZURE_CONTAINER}`,
      );
    } else {
      this.fallbackToFilesystem();
    }
  }

  private async initDefaultEnterpriseAdapter(
    type: string,
    config: any,
    logInfo: string,
  ) {
    logger.log(
      `Using ${type.toUpperCase()} Storage Adapter as default (${logInfo})`,
    );
    const adapter = await this.loadEnterpriseDriver(type, config);

    if (adapter) {
      this.adapters.set(DEFAULT_ADAPTER_KEY, {
        id: DEFAULT_ADAPTER_KEY,
        type,
        instance: adapter,
      });
    } else {
      this.fallbackToFilesystem(
        `${type.toUpperCase()} Enterprise driver not found`,
      );
    }
  }

  private fallbackToFilesystem(reason?: string) {
    if (reason) logger.warn(`${reason} - Falling back to Filesystem`);
    logger.log('Using Filesystem Storage Adapter as default');

    this.adapters.set(DEFAULT_ADAPTER_KEY, {
      id: DEFAULT_ADAPTER_KEY,
      type: STORAGE_TYPE.FILESYSTEM,
      instance: new FilesystemStorageAdapter() as any,
    });
  }

  private async loadEnterpriseDriver(
    type: string,
    config: any,
  ): Promise<StorageAdapter | null> {
    try {
      let modulePath = '';
      let className = '';

      switch (type) {
        case STORAGE_TYPE.S3:
          modulePath = '../../enterprise/storage/s3-storage.adapter';
          className = 'S3StorageAdapter';
          break;
        case STORAGE_TYPE.GCS:
          modulePath = '../../enterprise/storage/gcs-enterprise.adapter';
          className = 'GcsEnterpriseAdapter';
          break;
        case STORAGE_TYPE.AZURE:
          modulePath = '../../enterprise/storage/azure-enterprise.adapter';
          className = 'AzureEnterpriseAdapter';
          break;
      }

      if (modulePath) {
        const mod = require(modulePath);
        if (mod && mod[className]) {
          return new mod[className](config);
        }
      }
    } catch (e: any) {
      logger.debug(`Could not load enterprise driver ${type}: ${e.message}`);
    }
    return null;
  }

  /**
   * Resolves the storage configuration for a given object key (e.g. 'docker/my-repo/manifest.json')
   */
  private async getStorageConfigForKey(
    key: string,
  ): Promise<StorageConfig | null> {
    if (!AppDataSource?.isInitialized) {
      // Early boot phase check
      return null;
    }

    try {
      const parts = String(key).split('/').filter(Boolean);
      if (parts.length >= 2) {
        const repoCandidate = parts[1];

        // 1. Try Cache
        const configFromCache = await this.getFromCache(repoCandidate);
        if (configFromCache !== undefined) return configFromCache;

        // 2. Try DB Lookup
        const configFromDb = await this.lookupRepoStorageConfig(repoCandidate);
        if (configFromDb) return configFromDb;
      }

      // 3. Fallback to default
      return this.getDefaultStorageConfig();
    } catch (err: any) {
      logger.debug(`getStorageConfigForKey failed: ${err.message}`);
      return null;
    }
  }

  private async getFromCache(
    repoCandidate: string,
  ): Promise<StorageConfig | null | undefined> {
    if (!this.repoStorageIdCache.has(repoCandidate)) return undefined;

    const storageId = this.repoStorageIdCache.get(repoCandidate);
    if (!storageId) return null; // Known miss

    if (this.storageConfigCache.has(storageId)) {
      return this.storageConfigCache.get(storageId)!;
    }

    const cfgRepo = AppDataSource.getRepository(StorageConfig);
    const cfg =
      (await cfgRepo.findOneBy({ id: storageId })) ||
      (await cfgRepo.findOneBy({ key: storageId }));

    if (cfg) {
      this.storageConfigCache.set(storageId, cfg);
      return cfg;
    }
    return undefined;
  }

  private async lookupRepoStorageConfig(
    repoNameCandidate: string,
  ): Promise<StorageConfig | null> {
    const candidates = tryNormalizeRepoNames(repoNameCandidate);
    const repoRepo = AppDataSource.getRepository(RepositoryEntity);

    let foundRepo: any = null;
    for (const c of candidates) {
      // UUID check
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          c,
        );
      const whereCondition = isUuid ? [{ name: c }, { id: c }] : [{ name: c }];

      try {
        foundRepo = await repoRepo.findOne({
          where: whereCondition,
          select: ['id', 'name', 'config'],
        });
      } catch {
        /* ignore */
      }

      if (foundRepo) break;
    }

    if (foundRepo?.config) {
      const storageId =
        foundRepo.config.storageId || foundRepo.config.storageKey;
      this.repoStorageIdCache.set(repoNameCandidate, storageId || null);

      if (storageId) {
        const cfgRepo = AppDataSource.getRepository(StorageConfig);
        const cfg =
          (await cfgRepo.findOneBy({ id: storageId })) ||
          (await cfgRepo.findOneBy({ key: storageId }));
        if (cfg) {
          this.storageConfigCache.set(storageId, cfg);
          return cfg;
        }
      }
    } else if (!foundRepo) {
      this.repoStorageIdCache.set(repoNameCandidate, null);
    }

    return null;
  }

  async getDefaultStorageConfig(): Promise<StorageConfig | null> {
    if (!AppDataSource?.isInitialized) return null;
    try {
      const cfgRepo = AppDataSource.getRepository(StorageConfig);
      return (
        (await cfgRepo.findOne({
          where: { isDefault: true, usage: 'repository' },
        })) || (await cfgRepo.findOneBy({ isDefault: true }))
      );
    } catch (err) {
      return null;
    }
  }

  private async getAdapterForKey(key: string): Promise<StorageAdapter> {
    const cfg = await this.getStorageConfigForKey(key);

    if (!cfg) {
      return this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
    }

    if (this.adapters.has(cfg.id)) {
      return this.adapters.get(cfg.id)!.instance;
    }

    // Lazy load the adapter if not in memory
    return this.getAdapterForId(cfg.id);
  }

  // Public API delegates to adapters
  async save(key: string, data: Buffer | string) {
    const adapter = await this.getAdapterForKey(key);
    return adapter.save(key, data);
  }

  async saveStream(key: string, stream: Readable) {
    const adapter = await this.getAdapterForKey(key);
    if (adapter.saveStream) {
      return adapter.saveStream(key, stream);
    }

    // Fallback buffering
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
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
      // 5s TTL for small files
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

    // File protocol fallback for local fs
    const url = await adapter.getUrl(key);
    if (url?.startsWith('file://')) {
      const fp = url.replace(/^file:\/\//, '');
      const fsAdapter = this.adapters.get(DEFAULT_ADAPTER_KEY)
        ?.instance as unknown as FilesystemStorageAdapter;
      if (fsAdapter?.getStream) {
        return fsAdapter.getStream(fp, range);
      }
    }
    throw new Error('Stream not supported for this adapter');
  }

  /**
   * Retrieves or initializes a storage adapter by ID, performing license checks for Enterprise backends.
   */
  async getAdapterForId(storageId: string | null): Promise<StorageAdapter> {
    const defaultInstance = this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
    if (!storageId) return defaultInstance;

    if (this.adapters.has(storageId)) {
      return this.adapters.get(storageId)!.instance;
    }

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore - Handle potential null from findOneBy
    const cfg =
      (await this.storageConfigCache.get(storageId)) ??
      (await AppDataSource.getRepository(StorageConfig)
        .findOneBy({ id: storageId })
        .catch(() => null));

    if (!cfg) {
      logger.warn(`Storage config ${storageId} not found, using default`);
      return defaultInstance;
    }

    const isEnterprise = ENTERPRISE_STORAGE_TYPES.includes(cfg.type as any);
    let isReadOnly = false;

    if (isEnterprise) {
      const hasLicense = await this.checkEnterpriseLicense(cfg.type);
      if (!hasLicense) {
        logger.warn(
          `Enterprise storage '${cfg.type}' requires a license. ` +
            `Enabling READ-ONLY mode for existing data.`,
        );
        isReadOnly = true;
      }
    }

    const instance = await this.createAdapterInstance(cfg);

    if (cfg.type !== STORAGE_TYPE.FILESYSTEM && !instance) {
      throw new Error(
        `Storage adapter '${cfg.type}' is an Enterprise feature (missing driver).`,
      );
    }

    if (isReadOnly && instance) {
      const wrapped = new ReadOnlyStorageWrapper(
        instance,
        cfg.type.toUpperCase(),
      );
      this.adapters.set(cfg.id, {
        id: cfg.id,
        type: cfg.type,
        instance: wrapped,
        readOnly: true,
      });
      return wrapped;
    }

    this.adapters.set(cfg.id, {
      id: cfg.id,
      type: cfg.type,
      instance: instance!,
    });
    return instance!;
  }

  private async checkEnterpriseLicense(type: string): Promise<boolean> {
    try {
      // Dynamic imports to avoid strict coupling with enterprise modules
      const { isEnterpriseFeature } = await import('../license/features');
      if (!isEnterpriseFeature(`storage.${type}`)) {
        return true;
      }

      const { License } = await import('../../entities/license.entity');
      const activeLicense = await AppDataSource.getRepository(License).findOne({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });

      return !!activeLicense;
    } catch (e) {
      // If enterprise modules are missing, we can't verify license -> deny write access
      return false;
    }
  }

  private async createAdapterInstance(
    cfg: StorageConfig,
  ): Promise<StorageAdapter | null> {
    if (cfg.type === STORAGE_TYPE.S3) {
      const config: any = cfg.config || {};
      const driverConfig = config.bucket
        ? {
            bucket: config.bucket,
            region: config.region,
            accessKey: config.accessKey,
            secretKey: config.secretKey,
            endpoint: config.endpoint,
            s3ForcePathStyle: config.s3ForcePathStyle,
          }
        : config;
      return this.loadEnterpriseDriver(STORAGE_TYPE.S3, driverConfig);
    }

    if (cfg.type === STORAGE_TYPE.GCS)
      return this.loadEnterpriseDriver(STORAGE_TYPE.GCS, cfg.config || {});
    if (cfg.type === STORAGE_TYPE.AZURE)
      return this.loadEnterpriseDriver(STORAGE_TYPE.AZURE, cfg.config || {});

    // Filesystem
    return new FilesystemStorageAdapter((cfg.config as any)?.basePath) as any;
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
        } catch (err: any) {
          logger.error(`Failed to migrate file ${file}: ${err.message}`);
        }
      }

      logger.log(`Migration of ${prefix} completed.`);
    });
  }
}
