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

import { Logger } from '@nestjs/common';
import AppDataSource from '../../data-source';
import { License } from '../../entities/license.entity';
import { StorageConfig } from '../../entities/storage-config.entity';
import { FilesystemStorageAdapter } from '../../storage/filesystem-storage.adapter';
import type { SaveResult } from '../../storage/storage.interface';
import { StorageConfigResolver } from './storage-config-resolver';
import { Readable } from 'stream';
import {
  DEFAULT_ADAPTER_KEY,
  ReadOnlyStorageWrapper,
  STORAGE_TYPE,
  isEnterpriseStorageType,
} from './storage-enterprise-support';

const logger = new Logger('StorageService');

export interface StorageAdapter {
  get(key: string): Promise<Buffer | null>;
  getStream(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{ stream: Readable; length?: number; size?: number } | null>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): Promise<string>;
  list?(prefix: string): Promise<string[]>;
  getMetadata?(key: string): Promise<{ size: number; mtime: Date } | null>;
  save(key: string, data: Buffer | string): Promise<SaveResult>;
  saveStream?(key: string, stream: Readable): Promise<SaveResult>;
  delete(key: string): Promise<boolean>;
}

type AdapterEntry = {
  id: string | typeof DEFAULT_ADAPTER_KEY;
  type: string;
  instance: StorageAdapter;
  readOnly?: boolean;
};

export class StorageAdapterRegistry {
  private readonly adapters = new Map<string, AdapterEntry>();

  constructor(private readonly configResolver: StorageConfigResolver) {}

  async initialize() {
    this.adapters.clear();
    await this.configureDefaultAdapter();
  }

  getDefaultAdapter(): StorageAdapter {
    return this.adapters.get(DEFAULT_ADAPTER_KEY)!.instance;
  }

  async getAdapterForKey(key: string): Promise<StorageAdapter> {
    const cfg = await this.configResolver.getStorageConfigForKey(key);
    if (!cfg) {
      return this.getDefaultAdapter();
    }

    if (this.adapters.has(cfg.id)) {
      return this.adapters.get(cfg.id)!.instance;
    }

    return this.getAdapterForId(cfg.id);
  }

  async getAdapterForId(storageId: string | null): Promise<StorageAdapter> {
    if (!storageId) {
      return this.getDefaultAdapter();
    }

    if (this.adapters.has(storageId)) {
      return this.adapters.get(storageId)!.instance;
    }

    const cfg = await this.configResolver.findStorageConfigById(storageId);
    if (!cfg) {
      logger.warn(`Storage config ${storageId} not found, using default`);
      return this.getDefaultAdapter();
    }

    const isEnterprise = isEnterpriseStorageType(cfg.type);
    const isReadOnly =
      isEnterprise && !(await this.checkEnterpriseLicense(cfg.type));

    if (isReadOnly) {
      logger.warn(
        `Enterprise storage '${cfg.type}' requires a license. Enabling READ-ONLY mode for existing data.`,
      );
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
      return;
    }

    if (envType === STORAGE_TYPE.GCS || GCS_BUCKET) {
      await this.initDefaultEnterpriseAdapter(
        STORAGE_TYPE.GCS,
        {},
        `Bucket: ${GCS_BUCKET}`,
      );
      return;
    }

    if (envType === STORAGE_TYPE.AZURE || AZURE_CONTAINER) {
      await this.initDefaultEnterpriseAdapter(
        STORAGE_TYPE.AZURE,
        {},
        `Container: ${AZURE_CONTAINER}`,
      );
      return;
    }

    this.fallbackToFilesystem();
  }

  private async initDefaultEnterpriseAdapter(
    type: string,
    config: Record<string, unknown>,
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
      return;
    }

    this.fallbackToFilesystem(
      `${type.toUpperCase()} Enterprise driver not found`,
    );
  }

  private fallbackToFilesystem(reason?: string) {
    if (reason) {
      logger.warn(`${reason} - Falling back to Filesystem`);
    }
    logger.log('Using Filesystem Storage Adapter as default');
    this.adapters.set(DEFAULT_ADAPTER_KEY, {
      id: DEFAULT_ADAPTER_KEY,
      type: STORAGE_TYPE.FILESYSTEM,
      instance: new FilesystemStorageAdapter() as StorageAdapter,
    });
  }

  private async createAdapterInstance(
    cfg: StorageConfig,
  ): Promise<StorageAdapter | null> {
    const config = (cfg.config ?? {}) as {
      bucket?: string;
      region?: string;
      accessKey?: string;
      secretKey?: string;
      endpoint?: string;
      s3ForcePathStyle?: boolean;
      basePath?: string;
    };

    if (cfg.type === STORAGE_TYPE.S3) {
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

    if (cfg.type === STORAGE_TYPE.GCS) {
      return this.loadEnterpriseDriver(STORAGE_TYPE.GCS, config);
    }
    if (cfg.type === STORAGE_TYPE.AZURE) {
      return this.loadEnterpriseDriver(STORAGE_TYPE.AZURE, config);
    }

    return new FilesystemStorageAdapter(config.basePath) as StorageAdapter;
  }

  private async checkEnterpriseLicense(type: string): Promise<boolean> {
    try {
      const { isEnterpriseFeature } = await import('../license/features');
      if (!isEnterpriseFeature(`storage.${type}`)) {
        return true;
      }

      const activeLicense = await AppDataSource.getRepository(License).findOne({
        where: { isActive: true },
        order: { createdAt: 'DESC' },
      });

      return !!activeLicense;
    } catch {
      return false;
    }
  }

  private async loadEnterpriseDriver(
    type: string,
    config: Record<string, unknown>,
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

      if (!modulePath) {
        return null;
      }

      const mod = require(modulePath) as Record<
        string,
        new (cfg: Record<string, unknown>) => StorageAdapter
      >;
      if (mod[className]) {
        return new mod[className](config);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.debug(`Could not load enterprise driver ${type}: ${message}`);
    }

    return null;
  }
}
