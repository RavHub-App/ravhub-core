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

import AppDataSource from '../../data-source';
import { RepositoryEntity } from '../../entities/repository.entity';
import { StorageConfig } from '../../entities/storage-config.entity';
import { tryNormalizeRepoNames } from '../../storage/key-utils';

export class StorageConfigResolver {
  private readonly repoStorageIdCache = new Map<string, string | null>();
  private readonly storageConfigCache = new Map<string, StorageConfig>();

  clear() {
    this.repoStorageIdCache.clear();
    this.storageConfigCache.clear();
  }

  async getStorageConfigForKey(key: string): Promise<StorageConfig | null> {
    if (!AppDataSource?.isInitialized) {
      return null;
    }

    try {
      const parts = String(key).split('/').filter(Boolean);
      if (parts.length >= 2) {
        const repoCandidate = parts[1];
        const configFromCache = await this.getFromCache(repoCandidate);
        if (configFromCache !== undefined) {
          return configFromCache;
        }

        const configFromDb = await this.lookupRepoStorageConfig(repoCandidate);
        if (configFromDb) {
          return configFromDb;
        }
      }

      return this.getDefaultStorageConfig();
    } catch {
      return null;
    }
  }

  async getDefaultStorageConfig(): Promise<StorageConfig | null> {
    if (!AppDataSource?.isInitialized) {
      return null;
    }

    try {
      const cfgRepo = AppDataSource.getRepository(StorageConfig);
      return (
        (await cfgRepo.findOne({
          where: { isDefault: true, usage: 'repository' },
        })) || (await cfgRepo.findOneBy({ isDefault: true }))
      );
    } catch {
      return null;
    }
  }

  async findStorageConfigById(
    storageId: string,
  ): Promise<StorageConfig | null> {
    if (!storageId || !AppDataSource?.isInitialized) {
      return null;
    }

    if (this.storageConfigCache.has(storageId)) {
      return this.storageConfigCache.get(storageId) ?? null;
    }

    const cfgRepo = AppDataSource.getRepository(StorageConfig);
    const cfg =
      (await cfgRepo.findOneBy({ id: storageId }).catch(() => null)) ||
      (await cfgRepo.findOneBy({ key: storageId }).catch(() => null));

    if (cfg) {
      this.storageConfigCache.set(storageId, cfg);
    }

    return cfg;
  }

  private async getFromCache(
    repoCandidate: string,
  ): Promise<StorageConfig | null | undefined> {
    if (!this.repoStorageIdCache.has(repoCandidate)) {
      return undefined;
    }

    const storageId = this.repoStorageIdCache.get(repoCandidate);
    if (!storageId) {
      return null;
    }

    return this.findStorageConfigById(storageId);
  }

  private async lookupRepoStorageConfig(
    repoNameCandidate: string,
  ): Promise<StorageConfig | null> {
    const candidates = tryNormalizeRepoNames(repoNameCandidate);
    const repoRepo = AppDataSource.getRepository(RepositoryEntity);

    let foundRepo: { config?: Record<string, unknown> } | null = null;
    for (const candidate of candidates) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidate,
        );
      const whereCondition = isUuid
        ? [{ name: candidate }, { id: candidate }]
        : [{ name: candidate }];

      foundRepo = await repoRepo
        .findOne({
          where: whereCondition,
          select: ['id', 'name', 'config'],
        })
        .catch(() => null);

      if (foundRepo) {
        break;
      }
    }

    if (!foundRepo?.config) {
      if (!foundRepo) {
        this.repoStorageIdCache.set(repoNameCandidate, null);
      }
      return null;
    }

    const rawStorageId =
      foundRepo.config.storageId ?? foundRepo.config.storageKey;
    const storageId =
      typeof rawStorageId === 'string' && rawStorageId.trim().length > 0
        ? rawStorageId
        : null;

    this.repoStorageIdCache.set(repoNameCandidate, storageId);

    if (!storageId) {
      return null;
    }

    return this.findStorageConfigById(storageId);
  }
}
