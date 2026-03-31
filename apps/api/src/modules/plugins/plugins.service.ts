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
import { IPlugin } from '../../plugins-core/plugin.interface';
import AppDataSource from '../../data-source';
import { StorageService } from '../storage/storage.service';
import { RepositoryEntity } from '../../entities/repository.entity';
import { AuditService } from '../audit/audit.service';
import { RedisService } from '../redis/redis.service';
import { RedlockService } from '../redis/redlock.service';
import { createPluginContext } from './plugin-context.factory';

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
  ) {}

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
    return createPluginContext({
      storage: this.storage,
      redis: this.redis.getClient(),
      redlock: this.redlock,
      auditService: this.auditService,
      logger: this.logger,
    });
  }

  list() {
    return Array.from(this.loaded.values()).map((p) => {
      const key = p.metadata.key;
      const iconPath = this.getIconPath(key);

      return {
        ...p.metadata,
        icon: iconPath ? `/plugins/${key}/icon` : undefined,
        installed: {
          key: p.metadata.key,
        },
      };
    });
  }

  getIconPath(key: string): string | undefined {
    const possibleIconPaths = [
      path.resolve(__dirname, 'impl', `${key}-plugin`, 'icon.png'),
      path.resolve(__dirname, '..', 'impl', `${key}-plugin`, 'icon.png'),
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'modules',
        'plugins',
        'impl',
        `${key}-plugin`,
        'icon.png',
      ),
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        'src',
        'modules',
        'plugins',
        'impl',
        `${key}-plugin`,
        'icon.png',
      ),
    ];

    return possibleIconPaths.find((iconPath) => fs.existsSync(iconPath));
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
