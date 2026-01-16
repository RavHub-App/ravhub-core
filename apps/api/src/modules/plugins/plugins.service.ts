import {
  Injectable,
  Logger,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { IPlugin } from '../../plugins-core/plugin.interface';
import AppDataSource from '../../data-source';
import { StorageService } from '../storage/storage.service';
import { Plugin } from '../../entities/plugin.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import { AuditService } from '../audit/audit.service';
import { MonitorService } from '../monitor/monitor.service';
import { RedisService } from '../redis/redis.service';
import { RedlockService } from '../redis/redlock.service';

// Static Imports for Built-in Features (Local Implementations)
import npmPlugin from './impl/npm-plugin';
import pypiPlugin from './impl/pypi-plugin';
import dockerPlugin from './impl/docker-plugin';
import mavenPlugin from './impl/maven-plugin';

import * as path from 'path';
import * as fs from 'fs';

@Injectable()
export class PluginsService implements OnModuleInit {
  private readonly logger = new Logger(PluginsService.name);
  private loaded: Map<string, IPlugin> = new Map();

  constructor(
    private readonly storage: StorageService,
    @Inject(forwardRef(() => MonitorService))
    private readonly monitor: MonitorService,
    private readonly auditService: AuditService,
    private readonly redis: RedisService,
    private readonly redlock: RedlockService,
  ) { }

  async onModuleInit() {
    // Initialize AppDataSource before loading features so they can use it
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
   * Initialize and register built-in features (previously plugins)
   */
  private async loadBuiltInFeatures() {
    let features: any[] = [
      npmPlugin,
      pypiPlugin,
      dockerPlugin,
      mavenPlugin,
    ];

    const enterprisePlugins = [
      'nuget-plugin',
      'composer-plugin',
      'helm-plugin',
      'rust-plugin',
      'raw-plugin',
    ];

    for (const pName of enterprisePlugins) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const p = require(`./impl/${pName}`).default;
        if (p) features.push(p);
      } catch (e) {
        // Plugin not found (Community Edition)
      }
    }

    // Check for active license to determine available features
    const { License } = await import('../../entities/license.entity');
    const licenseRepo = AppDataSource.getRepository(License);
    const activeLicense = await licenseRepo.findOne({
      where: { isActive: true },
      order: { createdAt: 'DESC' },
    });

    const isEnterprise = !!activeLicense;

    if (!isEnterprise) {
      const allowedCommunityPlugins = ['npm', 'pypi', 'docker', 'maven'];
      const restrictedCount = features.length;
      features = features.filter(p => allowedCommunityPlugins.includes(p.metadata.key));
      this.logger.warn(`⚠️  No active license found. Running in Community Edition.`);
      this.logger.warn(`ℹ️  Restricted ${restrictedCount - features.length} Enterprise plugins. Allowed: ${allowedCommunityPlugins.join(', ')}`);
    } else {
      this.logger.log(`✅ Enterprise License Active: Enabling full plugin suite.`);
    }

    this.logger.log(`Initializing ${features.length} built-in features...`);
    const context = this.getPluginContext();

    for (const plugin of features) {
      try {
        if (!this.isPluginConformant(plugin as any)) {
          this.logger.warn(
            `Feature ${plugin.metadata.key} failed conformance - skipping`,
          );
          continue;
        }

        await this.registerPluginInDb(plugin as any);

        if (typeof (plugin as any).init === 'function') {
          await (plugin as any).init(context);
        }

        this.loaded.set(plugin.metadata.key, plugin as any);
        this.logger.log(`Feature loaded: ${plugin.metadata.key}`);
      } catch (err: any) {
        this.logger.error(
          `Failed to initialize feature ${plugin.metadata?.key}: ${err.message}`,
        );
      }
    }
  }

  /**
   * Reload plugins dynamically after license activation
   * This allows enabling enterprise plugins without requiring a restart
   */
  async reloadPlugins(): Promise<{ ok: boolean; message: string; newPlugins: string[] }> {
    try {
      this.logger.log('🔄 Reloading plugins after license change...');

      const previousPlugins = Array.from(this.loaded.keys());

      // Clear current loaded plugins
      this.loaded.clear();

      // Reload with updated license check
      await this.loadBuiltInFeatures();

      const currentPlugins = Array.from(this.loaded.keys());
      const newPlugins = currentPlugins.filter(p => !previousPlugins.includes(p));

      if (newPlugins.length > 0) {
        this.logger.log(`✅ Enabled ${newPlugins.length} new plugins: ${newPlugins.join(', ')}`);
        return {
          ok: true,
          message: `Successfully enabled ${newPlugins.length} enterprise plugins`,
          newPlugins,
        };
      } else {
        return {
          ok: true,
          message: 'No new plugins to enable',
          newPlugins: [],
        };
      }
    } catch (err: any) {
      this.logger.error(`Failed to reload plugins: ${err.message}`);
      return {
        ok: false,
        message: `Failed to reload plugins: ${err.message}`,
        newPlugins: [],
      };
    }
  }

  private getPluginContext() {
    return {
      storage: this.storage,
      dataSource: AppDataSource,
      redis: this.redis,
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
      trackDownload: async (repo: any, name: string, version?: string) => {
        try {
          await this.monitor.increment(`downloads.${repo.id || repo.name}`);
          if (AppDataSource?.isInitialized) {
            const artifactRepo = AppDataSource.getRepository(Artifact);
            await artifactRepo
              .createQueryBuilder()
              .update(Artifact)
              .set({ lastAccessedAt: new Date() })
              .where('repositoryId = :repoId', { repoId: repo.id })
              .andWhere('packageName = :name', { name })
              .andWhere(
                version ? 'version = :version' : '1=1',
                version ? { version } : {},
              )
              .execute();
          }
        } catch (err: any) {
          // Silent fail
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
            } catch (e) {
              // ignore
            }
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

          const { buildKey, normalizeStorageKey } = require('../../storage/key-utils');
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

  async registerPluginInDb(plugin: IPlugin) {
    if (!AppDataSource.isInitialized) {
      this.logger.debug(
        'AppDataSource is not initialized; skipping DB registration for feature ' +
        plugin.metadata.key,
      );
      return;
    }
    const repo = AppDataSource.getRepository(Plugin);
    const existing = await repo.findOneBy({ key: plugin.metadata.key });
    if (!existing) {
      const entity = repo.create({
        key: plugin.metadata.key,
        name: plugin.metadata.name,
        metadata: plugin.metadata,
      });
      await repo.save(entity);
    } else {
      // update metadata if changed
      existing.name = plugin.metadata.name ?? existing.name;
      existing.metadata = {
        ...(existing.metadata ?? {}),
        ...(plugin.metadata ?? {}),
      };
      await repo.save(existing);
    }
  }

  list() {
    return Array.from(this.loaded.values()).map((p) => {
      const key = p.metadata.key;
      // Check if icon exists in the same way the controller does
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
          version: p.metadata.version,
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
