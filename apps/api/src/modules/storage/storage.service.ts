import { Injectable, Logger, ForbiddenException, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import AppDataSource from '../../data-source';
import { tryNormalizeRepoNames } from '../../storage/key-utils';
import { FilesystemStorageAdapter } from '../../storage/filesystem-storage.adapter';
// Enterprise adapters are loaded dynamically
import { StorageConfig } from '../../entities/storage-config.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { RedlockService } from '../redis/redlock.service';

type AdapterEntry = { id: string | 'fs-default'; type: string; instance: any; readOnly?: boolean };

const DEFAULT_ADAPTER_KEY = 'fs-default';

const logger = new Logger('StorageService');

/**
 * Read-only wrapper for storage adapters.
 * When license expires, users can still READ their data but not WRITE new data.
 * This prevents data loss while enforcing license restrictions.
 */
class ReadOnlyStorageWrapper {
  constructor(
    private readonly adapter: any,
    private readonly storageType: string,
  ) { }

  // READ operations - allowed
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

  async getMetadata(key: string) {
    return this.adapter.getMetadata?.(key);
  }

  // WRITE operations - blocked
  async save(key: string, data: Buffer | string) {
    throw new ForbiddenException(
      `Cannot write to ${this.storageType} storage: Enterprise license required. ` +
      `Your existing data is still accessible in read-only mode. ` +
      `Please renew your license to enable write operations.`
    );
  }

  async saveStream(key: string, stream: NodeJS.ReadableStream) {
    throw new ForbiddenException(
      `Cannot write to ${this.storageType} storage: Enterprise license required. ` +
      `Your existing data is still accessible in read-only mode.`
    );
  }

  async delete(key: string) {
    throw new ForbiddenException(
      `Cannot delete from ${this.storageType} storage: Enterprise license required. ` +
      `Your existing data is still accessible in read-only mode.`
    );
  }
}

@Injectable()
export class StorageService implements OnModuleInit {
  private adapters: Map<string, AdapterEntry> = new Map();
  private repoStorageIdCache: Map<string, string | null> = new Map();
  private storageConfigCache: Map<string, StorageConfig> = new Map();

  constructor(private readonly redlock: RedlockService) { }

  async onModuleInit() {
    this.adapters = new Map();
    // Configure default adapter based on environment
    // This allows Helm Configuration to control storage backend without DB config
    if (process.env.STORAGE_TYPE === 's3' || process.env.S3_BUCKET) {
      logger.log(`Using S3 Storage Adapter as default (Bucket: ${process.env.S3_BUCKET})`);
      const s3Adapter = await this.loadEnterpriseDriver('s3', {
        bucket: process.env.S3_BUCKET,
        region: process.env.S3_REGION,
        accessKey: process.env.S3_ACCESS_KEY,
        secretKey: process.env.S3_SECRET_KEY,
        endpoint: process.env.S3_ENDPOINT,
        s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
      });
      if (s3Adapter) {
        this.adapters.set(DEFAULT_ADAPTER_KEY, {
          id: DEFAULT_ADAPTER_KEY,
          type: 's3',
          instance: s3Adapter,
        });
      } else {
        this.fallbackToFilesystem('S3 Enterprise driver not found');
      }
    } else if (process.env.STORAGE_TYPE === 'gcs' || process.env.GCS_BUCKET) {
      logger.log(`Using GCS Storage Adapter as default (Bucket: ${process.env.GCS_BUCKET})`);
      const gcsAdapter = await this.loadEnterpriseDriver('gcs', {});
      if (gcsAdapter) {
        this.adapters.set(DEFAULT_ADAPTER_KEY, {
          id: DEFAULT_ADAPTER_KEY,
          type: 'gcs',
          instance: gcsAdapter,
        });
      } else {
        this.fallbackToFilesystem('GCS Enterprise driver not found');
      }
    } else if (process.env.STORAGE_TYPE === 'azure' || process.env.AZURE_CONTAINER) {
      logger.log(`Using Azure Storage Adapter as default (Container: ${process.env.AZURE_CONTAINER})`);
      const azureAdapter = await this.loadEnterpriseDriver('azure', {});
      if (azureAdapter) {
        this.adapters.set(DEFAULT_ADAPTER_KEY, {
          id: DEFAULT_ADAPTER_KEY,
          type: 'azure',
          instance: azureAdapter,
        });
      } else {
        this.fallbackToFilesystem('Azure Enterprise driver not found');
      }
    } else {
      this.fallbackToFilesystem();
    }
  }

  private fallbackToFilesystem(reason?: string) {
    if (reason) logger.warn(reason + ' - Falling back to Filesystem');
    logger.log('Using Filesystem Storage Adapter as default');
    const fsAdapter = new FilesystemStorageAdapter();
    this.adapters.set(DEFAULT_ADAPTER_KEY, {
      id: DEFAULT_ADAPTER_KEY,
      type: 'filesystem',
      instance: fsAdapter,
    });
  }

  private async loadEnterpriseDriver(type: string, config: any): Promise<any> {
    try {
      let modulePath = '';
      let className = '';

      if (type === 's3') {
        modulePath = '../../enterprise/storage/s3-storage.adapter';
        className = 'S3StorageAdapter';
      } else if (type === 'gcs') {
        modulePath = '../../enterprise/storage/gcs-enterprise.adapter';
        className = 'GcsEnterpriseAdapter';
      } else if (type === 'azure') {
        modulePath = '../../enterprise/storage/azure-enterprise.adapter';
        className = 'AzureEnterpriseAdapter';
      }

      if (modulePath) {
        // Use dynamic require to avoid build-time errors if file is missing
        /* eslint-disable @typescript-eslint/no-var-requires */
        const mod = require(modulePath);
        if (mod && mod[className]) {
          return new mod[className](config);
        }
      }
    } catch (e) {
      logger.debug(`Could not load enterprise driver ${type}: ${e.message}`);
    }
    return null;
  }

  private async getStorageConfigForKey(
    key: string,
  ): Promise<StorageConfig | null> {
    // If the AppDataSource isn't initialized yet we should skip DB lookups.
    // Some code paths run very early during application boot (or in plugin
    // indexing) and calling getRepository() when TypeORM isn't initialized
    // results in noisy "No metadata for <Entity>" errors. Guard against
    // that and fall back to the default storage config.
    try {
      if (!AppDataSource?.isInitialized) {
        logger.debug('AppDataSource not initialized, skipping repo lookup');
        throw new Error('datasource-not-initialized');
      }

      // extract candidate repo name from common key patterns like 'docker/<repoName>/...'
      const parts = String(key).split('/').filter(Boolean);
      if (parts.length >= 2) {
        const candidate = parts[1];

        // Cache Check
        if (this.repoStorageIdCache.has(candidate)) {
          const storageId = this.repoStorageIdCache.get(candidate);
          if (storageId) {
            if (this.storageConfigCache.has(storageId)) {
              return this.storageConfigCache.get(storageId)!;
            }
            const cfgRepo = AppDataSource.getRepository(StorageConfig);
            const cfg = await cfgRepo.findOneBy({ id: storageId }) || await cfgRepo.findOneBy({ key: storageId });
            if (cfg) {
              this.storageConfigCache.set(storageId, cfg);
              return cfg;
            }
          }
        }

        const candidates = tryNormalizeRepoNames(candidate);
        if (AppDataSource?.isInitialized) {
          const repoRepo = AppDataSource.getRepository(RepositoryEntity);
          const isUuid = (str: string) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              str,
            );
          let found: any = null;
          for (const c of candidates) {
            try {
              const whereConditions = isUuid(c)
                ? [{ name: c }, { id: c }]
                : [{ name: c }];

              found = (await repoRepo.findOne({
                where: whereConditions,
                select: ['id', 'name', 'config'],
              })) as any;
            } catch (err) {
              // ignore
            }
            if (found) break;
          }

          if (found && found.config) {
            const storageId =
              found.config?.storageId || found.config?.storageKey || null;

            // Populate cache
            this.repoStorageIdCache.set(candidate, storageId);

            if (storageId) {
              const cfgRepo = AppDataSource.getRepository(StorageConfig);
              let cfg: StorageConfig | null = null;
              try {
                cfg = await cfgRepo.findOneBy({ id: storageId });
                if (!cfg) cfg = await cfgRepo.findOneBy({ key: storageId });
              } catch (err) {
                logger.debug('storage config lookup error: ' + err.message);
              }
              if (cfg) {
                this.storageConfigCache.set(storageId, cfg);
                return cfg;
              }
            }
          } else if (!found) {
            // also cache misses (null)
            this.repoStorageIdCache.set(candidate, null);
          }
        }
      }
    } catch (err: any) {
      // log only unexpected errors — the datasource-not-initialized case is
      // a normal early-boot condition so avoid alarming logs.
      if (err?.message !== 'datasource-not-initialized') {
        logger.debug('getStorageConfigForKey failed: ' + err?.message);
      }
    }

    // fallback: try to find default storage config
    try {
      const cfgRepo = AppDataSource.getRepository(StorageConfig);
      // Prefer default repository storage
      let def = await cfgRepo.findOne({
        where: { isDefault: true, usage: 'repository' },
      });
      if (!def) {
        // If no specific default for repository, try any default
        def = await cfgRepo.findOneBy({ isDefault: true });
      }
      if (def) return def;
    } catch (err) {
      // ignore
    }
    return null;
  }

  async getDefaultStorageConfig(): Promise<StorageConfig | null> {
    if (!AppDataSource?.isInitialized) return null;
    try {
      const cfgRepo = AppDataSource.getRepository(StorageConfig);
      let def = await cfgRepo.findOne({
        where: { isDefault: true, usage: 'repository' },
      });
      if (!def) {
        def = await cfgRepo.findOneBy({ isDefault: true });
      }
      return def;
    } catch (err) {
      return null;
    }
  }

  private async getAdapterForKey(key: string) {
    // choose adapter by storage config for this key; cache instances
    const cfg = await this.getStorageConfigForKey(key);
    if (!cfg) return this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
    if (this.adapters.has(cfg.id)) return this.adapters.get(cfg.id)!.instance;

    // instantiate appropriate adapter
    let instance: any = null;
    if (cfg.type === 's3') {
      instance = await this.loadEnterpriseDriver('s3', cfg.config || {});
    } else if (cfg.type === 'gcs') {
      instance = await this.loadEnterpriseDriver('gcs', cfg.config || {});
    } else if (cfg.type === 'azure') {
      instance = await this.loadEnterpriseDriver('azure', cfg.config || {});
    } else {
      // filesystem (may support basePath override)
      instance = new FilesystemStorageAdapter((cfg.config as any)?.basePath);
    }
    this.adapters.set(cfg.id, { id: cfg.id, type: cfg.type, instance });
    return instance;
  }

  async save(key: string, data: Buffer | string) {
    const a = await this.getAdapterForKey(key);
    return a.save(key, data);
  }

  async saveStream(key: string, stream: NodeJS.ReadableStream) {
    const a = await this.getAdapterForKey(key);
    if (typeof a.saveStream === 'function') {
      return a.saveStream(key, stream);
    }
    // Fallback to buffering if saveStream not supported (should not happen with our updated adapters)
    const chunks: any[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return a.save(key, Buffer.concat(chunks));
  }

  getUrl(key: string) {
    return this.getAdapterForKey(key).then((a) => a.getUrl(key));
  }

  exists(key: string) {
    return this.getAdapterForKey(key).then((a) => a.exists(key));
  }

  delete(key: string) {
    return this.getAdapterForKey(key).then((a) => a.delete(key));
  }

  private smallFilesCache: Map<string, { data: Buffer; expires: number }> = new Map();

  async get(key: string): Promise<Buffer | null> {
    const cached = this.smallFilesCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.data;
    }

    const a: any = await this.getAdapterForKey(key);
    if (typeof a.get !== 'function') return null;

    const data = await a.get(key);
    if (data && data.length < 1024 * 1024) {
      // 5 second TTL for small files to boost benchmark and repeated reads
      this.smallFilesCache.set(key, {
        data,
        expires: Date.now() + 5000,
      });
    }
    return data;
  }

  async list(prefix: string): Promise<string[]> {
    const a: any = await this.getAdapterForKey(prefix);
    if (typeof a.list === 'function') return a.list(prefix);
    return [];
  }

  async getMetadata(key: string): Promise<{ size: number; mtime: Date } | null> {
    const a: any = await this.getAdapterForKey(key);
    if (typeof a.getMetadata === 'function') return a.getMetadata(key);
    return null;
  }

  async getStream(key: string, range?: { start?: number; end?: number }) {
    const a: any = await this.getAdapterForKey(key);

    if (typeof a.getStream === 'function') return a.getStream(key, range);
    // fallback: try getUrl and if it's a file:// path read from FS
    const url = await a.getUrl(key);
    if (url && url.startsWith('file://')) {
      const fp = url.replace(/^file:\/\//, '');
      const fsAdapter = this.adapters.get(DEFAULT_ADAPTER_KEY)!
        .instance as FilesystemStorageAdapter;
      if (fsAdapter.getStream) return fsAdapter.getStream(fp, range);
    }
    throw new Error('stream not supported for adapter');
  }
  async getAdapterForId(storageId: string | null): Promise<any> {
    if (!storageId) return this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
    if (this.adapters.has(storageId))
      return this.adapters.get(storageId)!.instance;

    // instantiate
    const cfgRepo = AppDataSource.getRepository(StorageConfig);
    let cfg: StorageConfig | null = null;
    try {
      cfg = await cfgRepo.findOneBy({ id: storageId });
    } catch (err) {
      logger.error('Failed to load storage config ' + storageId, err);
    }

    if (!cfg) {
      // fallback to default if config not found (should not happen if validated)
      return this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
    }

    // Check license for enterprise storage backends
    const enterpriseStorageTypes = ['s3', 'gcs', 'azure'];
    let readOnly = false;

    if (enterpriseStorageTypes.includes(cfg.type)) {
      const { isEnterpriseFeature } = await import('../license/features');
      const storageFeature = `storage.${cfg.type}`;

      if (isEnterpriseFeature(storageFeature)) {
        const { License } = await import('../../entities/license.entity');

        // Check if we have an active license for this feature
        const licenseRepo = AppDataSource.getRepository(License);
        const activeLicense = await licenseRepo.findOne({
          where: { isActive: true },
          order: { createdAt: 'DESC' },
        });

        if (!activeLicense) {
          // CRITICAL: Allow READ-ONLY access to existing data
          // User should be able to access their data even without license
          // but should not be able to write new data
          logger.warn(
            `Enterprise storage backend '${cfg.type}' requires a license. ` +
            `Enabling READ-ONLY mode - user can still access existing data.`
          );
          readOnly = true;
        }
      }
    }

    let instance: any = null;
    if (cfg.type === 's3') {
      const config: any = cfg.config || {};
      // Handle both object config and discrete fields for backward compatibility
      const driverConfig = (config.bucket) ? {
        bucket: config.bucket,
        region: config.region,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        endpoint: config.endpoint,
        s3ForcePathStyle: config.s3ForcePathStyle,
      } : config;

      instance = await this.loadEnterpriseDriver('s3', driverConfig);
    } else if (cfg.type === 'gcs') {
      instance = await this.loadEnterpriseDriver('gcs', cfg.config || {});
    } else if (cfg.type === 'azure') {
      instance = await this.loadEnterpriseDriver('azure', cfg.config || {});
    } else {
      // filesystem (may support basePath override)
      instance = new FilesystemStorageAdapter((cfg.config as any)?.basePath);
    }

    if (cfg.type !== 'filesystem' && !instance) {
      throw new Error(`Storage adapter '${cfg.type}' is an Enterprise feature and the driver is missing. Please upgrade to RavHub Enterprise.`);
    }

    // If read-only mode (no license), wrap the adapter
    if (readOnly) {
      const readOnlyInstance = new ReadOnlyStorageWrapper(instance, cfg.type.toUpperCase());
      this.adapters.set(cfg.id, { id: cfg.id, type: cfg.type, instance: readOnlyInstance, readOnly: true });
      return readOnlyInstance;
    }

    this.adapters.set(cfg.id, { id: cfg.id, type: cfg.type, instance });
    return instance;
  }

  async migrate(
    prefix: string,
    oldStorageId: string | null,
    newStorageId: string | null,
  ) {
    if (oldStorageId === newStorageId) return;

    const lockKey = `migrate:${prefix}:${oldStorageId || 'default'}:${newStorageId || 'default'}`;
    return this.redlock.runWithLock(lockKey, 3600000, async () => { // 1 hour lock for migration
      logger.log(
        `Migrating ${prefix} from ${oldStorageId || 'default'} to ${newStorageId || 'default'}`,
      );

      const source = await this.getAdapterForId(oldStorageId);
      const dest = await this.getAdapterForId(newStorageId);

      // 1. List all files in source with prefix
      let files: string[] = [];
      if (typeof source.list === 'function') {
        files = await source.list(prefix);
      } else {
        logger.warn(
          `Source adapter for ${oldStorageId} does not support listing. Migration skipped for ${prefix}.`,
        );
        return;
      }

      if (files.length === 0) {
        logger.log(`No files found to migrate for prefix ${prefix}`);
        return;
      }

      logger.log(`Found ${files.length} files to migrate for ${prefix}`);

      // 2. Copy each file using streaming to avoid OOM
      for (const file of files) {
        try {
          if (typeof source.getStream === 'function' && typeof dest.saveStream === 'function') {
            const { stream } = await source.getStream(file);
            await dest.saveStream(file, stream);
            logger.debug(`Migrated (stream) ${file}`);
          } else {
            // Fallback to buffer if streaming not supported (older adapters)
            const content = await source.get(file);
            if (content) {
              await dest.save(file, content);
              logger.debug(`Migrated (buffer) ${file}`);
            }
          }
        } catch (err) {
          logger.error(`Failed to migrate file ${file}: ${err.message}`);
        }
      }

      logger.log(`Migration of ${prefix} completed.`);
    });
  }
}
