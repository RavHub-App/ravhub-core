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

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IPlugin } from '../../plugins-core/plugin.interface';
import AppDataSource from '../../data-source';
import { StorageService } from '../storage/storage.service';
import { RepositoryEntity } from '../../entities/repository.entity';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { RedlockService } from '../redis/redlock.service';

import npmPlugin from './impl/npm-plugin';
import pypiPlugin from './impl/pypi-plugin';
import dockerPlugin from './impl/docker-plugin';
import mavenPlugin from './impl/maven-plugin';
import composerPlugin from './impl/composer-plugin';
import nugetPlugin from './impl/nuget-plugin';
import rustPlugin from './impl/rust-plugin';
import rawPlugin from './impl/raw-plugin';
import helmPlugin from './impl/helm-plugin';

import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class PluginsService implements OnModuleInit {
  private readonly logger = new Logger(PluginsService.name);
  private loaded: Map<string, IPlugin> = new Map();

  constructor(
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    private readonly redis: RedisService,
    private readonly redlock: RedlockService,
  ) { }

  async onModuleInit() {
    if (!AppDataSource.isInitialized) {
      try {
        this.logger.debug('Initializing AppDataSource...');
        await AppDataSource.initialize();
        this.logger.debug('AppDataSource initialized successfully');
      } catch (err: any) {
        this.logger.error(
          'AppDataSource initialization failed: ' + err.message,
        );
        throw err;
      }
    }
    try {
      await this.loadBuiltInFeatures();
    } catch (err) {
      this.logger.warn('Error loading built-in features: ' + err.message);
    }
  }

  /**
   * Initialize and register built-in features - all plugins now included in core
   */
  private async loadBuiltInFeatures() {
    const features: any[] = [
      npmPlugin,
      pypiPlugin,
      dockerPlugin,
      mavenPlugin,
      composerPlugin,
      nugetPlugin,
      rustPlugin,
      rawPlugin,
      helmPlugin,
    ];

    this.logger.log(`Initializing ${features.length} built-in plugins...`);
    const context = this.getPluginContext();

    for (const plugin of features) {
      try {
        if (!this.isPluginConformant(plugin)) {
          this.logger.warn(
            `Feature ${plugin.metadata.key} failed conformance - skipping`,
          );
          continue;
        }

        if (typeof plugin.init === 'function') {
          await plugin.init(context);
        }

        this.loaded.set(plugin.metadata.key, plugin);
        this.logger.log(`Feature loaded: ${plugin.metadata.key}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to initialize feature ${plugin.metadata?.key}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Reload plugins dynamically
   */
  async reloadPlugins(): Promise<{
    ok: boolean;
    message: string;
    newPlugins: string[];
  }> {
    try {
      this.logger.log('🔄 Reloading plugins...');

      const previousPlugins = Array.from(this.loaded.keys());

      this.loaded.clear();

      await this.loadBuiltInFeatures();

      const currentPlugins = Array.from(this.loaded.keys());
      const newPlugins = currentPlugins.filter(
        (p) => !previousPlugins.includes(p),
      );

      return {
        ok: true,
        message: 'Plugins reloaded successfully',
        newPlugins,
      };
    } catch (err: any) {
      this.logger.error(`Failed to reload plugins: ${err.message}`);
      return {
        ok: false,
        message: `Failed to reload plugins: ${err.message}`,
        newPlugins: [],
      };
    }
  }

  /**
   * Get the common context shared with all plugins
   */
  public getPluginContext() {
    return {
      storage: this.storage,
      redis: this.redis.getClient(),
      redlock: this.redlock,
      getRepo: async (id: string) => {
        if (!AppDataSource.isInitialized) return null;
        try {
          const repoRepo = AppDataSource.getRepository(RepositoryEntity);
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id,
            );
          let repo: RepositoryEntity | null = null;
          if (isUuid) {
            repo = await repoRepo.findOne({ where: { id } });
          }
          if (!repo) {
            repo = await repoRepo.findOne({ where: { name: id } });
          }
          return repo;
        } catch (err: any) {
          this.logger.error(`getRepo error: ${err.message}`);
          throw err;
        }
      },
      indexArtifact: async (
        repo: any,
        result: any,
        userId?: string,
        artifactPath?: string,
      ) => {
        try {
          if (!AppDataSource?.isInitialized) return;
          const { Artifact } = require('../../entities/artifact.entity');
          const artifactRepo = AppDataSource.getRepository(Artifact);

          let normalizedResult = result;
          if (typeof result === 'string') {
            try {
              normalizedResult = JSON.parse(result);
            } catch (e) {
              normalizedResult = { id: result };
            }
          }

          let metadata = normalizedResult.metadata ?? {};
          if (typeof metadata === 'string') {
            try {
              metadata = JSON.parse(metadata);
            } catch (e) { }
          }

          let packageName =
            metadata.name || metadata.packageName || normalizedResult.name;
          let packageVersion =
            metadata.version ||
            metadata.packageVersion ||
            normalizedResult.version;

          if (
            !packageName &&
            normalizedResult.id &&
            typeof normalizedResult.id === 'string'
          ) {
            const id = normalizedResult.id;
            if (id.includes('@') && !id.startsWith('@')) {
              const parts = id.split('@');
              packageName = parts[0];
              packageVersion = parts[1];
            } else if (id.includes(':')) {
              const parts = id.split(':');
              packageName = parts[0];
              packageVersion = parts[1];
            } else {
              packageName = id;
            }
          }

          if (!packageName) return;

          const {
            buildKey,
            normalizeStorageKey,
          } = require('../../storage/key-utils');
          const storageKeyRaw =
            metadata.storageKey || normalizedResult.id || null;
          const storageKey = storageKeyRaw
            ? normalizeStorageKey(storageKeyRaw)
            : buildKey(repo.name, packageName || 'artifact');

          const finalPath =
            artifactPath ||
            metadata.path ||
            (normalizedResult.id &&
              typeof normalizedResult.id === 'string' &&
              normalizedResult.id.includes('/')
              ? normalizedResult.id
              : null);

          let art = await artifactRepo.findOne({
            where: {
              repositoryId: repo.id,
              packageName: packageName,
              version: packageVersion,
            },
          });

          if (art) {
            art.size = metadata.size ?? art.size;
            art.contentHash = metadata.contentHash ?? art.contentHash;
            art.metadata = metadata;
            art.storageKey = storageKey;
            art.packageName = packageName;
            art.version = packageVersion;
            art.path = finalPath || art.path;
            await artifactRepo.save(art);
          } else {
            art = artifactRepo.create({
              repository: repo,
              repositoryId: repo.id,
              manager: repo.manager,
              packageName: packageName,
              version: packageVersion,
              storageKey,
              path: finalPath,
              size: metadata.size ?? undefined,
              contentHash: metadata.contentHash ?? undefined,
              metadata,
              userId,
            });
            await artifactRepo.save(art);
          }

          await this.auditService
            .logSuccess({
              userId: userId,
              action: 'artifact.index',
              entityType: 'artifact',
              entityId: art.id,
              details: {
                repositoryId: repo.id,
                repositoryName: repo.name,
                packageName: metadata.name,
                version: metadata.version,
                size: art.size,
                source: 'plugin-context',
              },
            })
            .catch(() => { });
        } catch (err: any) {
          this.logger.error(`indexArtifact error: ${err.message}`);
        }
      },
    };
  }

  list() {
    return Array.from(this.loaded.values()).map((p) => {
      const key = p.metadata.key;

      const possibleIconPaths = [
        path.join(__dirname, 'impl', `${key}-plugin`, 'icon.png'),
        path.join(__dirname, '..', 'impl', `${key}-plugin`, 'icon.png'),
      ];

      const iconExists = possibleIconPaths.some((p) => fs.existsSync(p));

      return {
        ...p.metadata,
        icon: iconExists ? `/plugins/${key}/icon` : undefined,
        installed: {
          key: p.metadata.key,
        },
      };
    });
  }

  getInstance(key: string): IPlugin | undefined {
    return this.loaded.get(key);
  }

  async ping(key: string) {
    const plugin = this.loaded.get(key);
    if (!plugin) return null;
    const raw =
      typeof plugin.ping === 'function' ? await plugin.ping() : { ok: true };

    const supportsHosted = !!(
      typeof plugin.upload === 'function' ||
      typeof plugin.download === 'function' ||
      typeof plugin.listVersions === 'function'
    );
    const supportsProxy = !!(typeof plugin.proxyFetch === 'function');
    const supportsGroup = supportsHosted || supportsProxy;
    const configSchema = (plugin as any).metadata?.configSchema ?? null;

    return {
      ...raw,
      capabilities: {
        repoTypes: [
          ...(supportsHosted ? ['hosted'] : []),
          ...(supportsProxy ? ['proxy'] : []),
          ...(supportsGroup ? ['group'] : []),
        ],
        configSchema,
      },
    };
  }

  private isPluginConformant(plugin: IPlugin) {
    if (!plugin || !plugin.metadata || !plugin.metadata.key) return false;
    const hasOp = !!(
      typeof plugin.upload === 'function' ||
      typeof plugin.download === 'function' ||
      typeof plugin.listVersions === 'function' ||
      typeof plugin.proxyFetch === 'function' ||
      typeof plugin.authenticate === 'function'
    );
    return hasOp;
  }
}
