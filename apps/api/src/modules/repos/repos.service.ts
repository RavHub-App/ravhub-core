import {
  Injectable,
  OnModuleInit,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PluginsService } from '../plugins/plugins.service';
import { PluginManagerService } from '../plugins/plugin-manager.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { RepositoryPermissionService } from './repository-permission.service';
import { LicenseService } from '../license/license.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepositoryEntity } from '../../entities/repository.entity';
import { Artifact } from '../../entities/artifact.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ReposService implements OnModuleInit {
  private readonly logger = new Logger(ReposService.name);

  constructor(
    @InjectRepository(RepositoryEntity)
    private repo: Repository<RepositoryEntity>,
    @InjectRepository(Artifact)
    private artifactRepo: Repository<Artifact>,
    private readonly plugins: PluginsService,
    private readonly pluginManager: PluginManagerService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
    private readonly repositoryPermissionService: RepositoryPermissionService,
    private readonly licenseService: LicenseService,
  ) { }

  private repoCache: Map<string, { ent: RepositoryEntity; expires: number }> = new Map();

  async findOneCached(idOrName: string): Promise<RepositoryEntity | null> {
    const cached = this.repoCache.get(idOrName);
    if (cached && cached.expires > Date.now()) {
      return cached.ent;
    }

    const ent = await this.findOne(idOrName);
    if (ent) {
      // Short TTL: 10 seconds is enough to avoid DB storm during benchmarks
      // but safe enough for distributed context (configs don't change that fast)
      const expires = Date.now() + 10000;
      this.repoCache.set(idOrName, { ent: ent as any, expires });
      this.repoCache.set((ent as any).id, { ent: ent as any, expires });
      this.repoCache.set((ent as any).name, { ent: ent as any, expires });
    }
    return ent;
  }

  get storageService() {
    return this.storage;
  }

  async onModuleInit() {
    // Restart all Docker registries on application startup
    try {
      const dockerRepos = await this.repo.find({
        where: { manager: 'docker' },
      });
      this.logger.log(`Restarting ${dockerRepos.length} Docker registries...`);

      // Build repos map for group resolution
      const allRepos = await this.repo.find();
      const reposById = new Map();
      for (const r of allRepos) {
        reposById.set(r.id, r);
        reposById.set(r.name, r);
      }

      for (const repoEnt of dockerRepos) {
        try {
          const inst = this.pluginManager.getPluginForRepo(repoEnt as any);
          if (inst && typeof inst.startRegistryForRepo === 'function') {
            const provided = repoEnt.config?.docker ?? repoEnt.config ?? {};
            // Apply default port=0 if not specified (0 means auto-select ephemeral port)
            const port = provided.port !== undefined ? provided.port : 0;
            const opts = {
              port,
              version: provided.version,
              pluginManager: this.pluginManager,
              reposById,
            };
            const out: any = await inst.startRegistryForRepo(
              repoEnt as any,
              opts,
            );
            if (out?.ok && out.port) {
              this.logger.log(
                `Started registry for ${repoEnt.name} on port ${out.port}`,
              );
              // If port was auto-selected (port=0 initially), persist it
              if (out.needsPersistence && out.port !== port) {
                const newCfg = {
                  ...(repoEnt.config ?? {}),
                  docker: {
                    ...(repoEnt.config?.docker ?? {}),
                    port: out.port,
                  },
                };
                await this.repo.update(repoEnt.id, { config: newCfg } as any);
                this.logger.log(
                  `Persisted auto-selected port ${out.port} for ${repoEnt.name}`,
                );
              }
            }
          }
        } catch (err) {
          this.logger.warn(
            `Failed to restart registry for ${repoEnt.name}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Error restarting Docker registries: ${err.message}`);
    }

    // Trigger background scan of artifacts to populate DB stats
    setTimeout(() => {
      this.scanArtifacts().then((res) => {
        this.logger.log(`Initial artifact scan completed. Found ${res.count} new artifacts.`);
      }).catch((err) => {
        this.logger.error(`Initial artifact scan failed: ${err.message}`);
      });
    }, 5000);
  }

  // Normalize repository entity into a safe DTO for API responses.
  private inferManagerFromName(name?: string) {
    if (!name) return undefined;
    const n = name.toLowerCase();
    if (n.includes('maven')) return 'maven';
    if (n.includes('npm')) return 'npm';
    if (n.includes('docker') || n.includes('registry')) return 'docker';
    if (n.includes('nuget')) return 'nuget';
    if (n.includes('pypi') || n.includes('python')) return 'pypi';
    if (n.includes('composer')) return 'composer';
    return undefined;
  }

  private normalize(ent?: RepositoryEntity | null) {
    if (!ent) return null;

    const dockerPort = ent.config?.docker?.port;
    const dockerAccessUrl = ent.config?.docker?.accessUrl;
    const routeName = ent.name || ent.id;

    const managerInferred = ent.manager || this.inferManagerFromName(ent.name);
    const typeInferred = ent.type || (managerInferred ? 'hosted' : undefined);

    // Prefer an explicit per-repo docker accessUrl if the plugin or controller
    // configured it (should be an absolute url like "http://host:port").
    if (managerInferred === 'docker') {
      const upstreamStatus = this.pluginManager.getUpstreamPingStatus(
        ent.id || ent.name,
      );
      if (
        dockerAccessUrl &&
        typeof dockerAccessUrl === 'string' &&
        dockerAccessUrl.trim()
      ) {
        const pluginMeta = this.plugins
          ?.list()
          .find((m) => m.key === managerInferred);
        const pluginIcon = pluginMeta?.icon ? pluginMeta.icon : undefined;
        // If this is a proxy repo and we don't yet have a ping record, trigger
        // one in the background so callers will get a fresh result on subsequent
        // requests. Do not await, this is fire-and-forget.
        if (typeInferred === 'proxy' && !upstreamStatus) {
          (async () => {
            try {
              await this.pluginManager.triggerUpstreamPingForRepo(ent as any);
            } catch (e) {
              this.logger.debug('background ping failed: ' + String(e));
            }
          })();
        }

        return {
          id: ent.id,
          name: ent.name,
          type: typeInferred,
          manager: managerInferred,
          config: ent.config ?? {},
          roles: ent.roles ?? [],
          accessUrl: dockerAccessUrl,
          upstreamStatus,
          icon: pluginIcon,
        } as any;
      }

      // If no explicit accessUrl was provided, but we have a configured port,
      // construct a reasonable host:port URL. Prefer a dedicated REGISTRY_HOST
      // (set in env) otherwise fall back to localhost.
      if (dockerPort) {
        const upstreamStatus = this.pluginManager.getUpstreamPingStatus(
          ent.id || ent.name,
        );
        if (typeInferred === 'proxy' && !upstreamStatus) {
          (async () => {
            try {
              await this.pluginManager.triggerUpstreamPingForRepo(ent as any);
            } catch (e) {
              this.logger.debug('background ping failed: ' + String(e));
            }
          })();
        }
        const pluginMeta = this.plugins
          ?.list()
          .find((m) => m.key === managerInferred);
        const pluginIcon = pluginMeta?.icon ? pluginMeta.icon : undefined;
        const host = process.env.REGISTRY_HOST || 'localhost';
        const proto = process.env.REGISTRY_PROTOCOL || 'http';
        return {
          id: ent.id,
          name: ent.name,
          type: typeInferred,
          manager: managerInferred,
          config: ent.config ?? {},
          roles: ent.roles ?? [],
          accessUrl: `${proto}://${host}:${dockerPort}`,
          upstreamStatus,
          icon: pluginIcon,
        } as any;
      }
    }

    const accessUrl = `/repository/${routeName}`;

    // include a plugin icon URL when a matching plugin is loaded
    const pluginMeta = this.plugins
      ?.list()
      .find((m) => m.key === managerInferred);
    const pluginIcon = pluginMeta?.icon ? pluginMeta.icon : undefined;
    const upstreamStatus = this.pluginManager.getUpstreamPingStatus(
      ent.id || ent.name,
    );
    if (typeInferred === 'proxy' && !upstreamStatus) {
      (async () => {
        try {
          await this.pluginManager.triggerUpstreamPingForRepo(ent as any);
        } catch (e) {
          this.logger.debug('background ping failed: ' + String(e));
        }
      })();
    }

    return {
      id: ent.id,
      name: ent.name,
      type: typeInferred,
      manager: managerInferred,
      config: ent.config ?? {},
      roles: ent.roles ?? [],
      accessUrl,
      upstreamStatus,
      icon: pluginIcon,
    } as any;
  }

  findAll() {
    // include role relations so frontend can make per-repo RBAC decisions
    // return normalized DTOs so frontend always receives type/manager/config and an accessUrl
    return this.repo
      .find({ relations: ['roles', 'roles.permissions'] })
      .then((list) => list.map((l) => this.normalize(l)));
  }

  async findOne(idOrName: string) {
    // Check if input looks like a UUID to avoid PostgreSQL errors
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        idOrName,
      );

    let ent: RepositoryEntity | null = null;

    // Only try by id if it looks like a UUID
    if (isUuid) {
      ent = await this.repo.findOne({
        where: { id: idOrName },
        relations: ['roles', 'roles.permissions'],
      });
      if (ent) return this.normalize(ent);
    }

    // Try by name (either as fallback or first attempt if not a UUID)
    ent = await this.repo.findOne({
      where: { name: idOrName },
      relations: ['roles', 'roles.permissions'],
    });
    return this.normalize(ent);
  }

  async create(data: Partial<RepositoryEntity>): Promise<RepositoryEntity> {
    // Ensure config object exists
    if (!data.config) {
      data.config = {};
    }

    // If no storageId provided, try to set default
    if (!data.config.storageId) {
      const defStorage = await this.storage.getDefaultStorageConfig();
      if (defStorage) {
        data.config.storageId = defStorage.id;
      }
    }

    const r = this.repo.create(data as any);
    const saved = (await this.repo.save(r as any)) as RepositoryEntity;

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'repository.create',
        entityType: 'repository',
        entityId: saved.id,
        details: { name: saved.name, type: saved.type, manager: saved.manager },
      })
      .catch(() => { });

    return saved;
  }

  async findArtifactById(id: string): Promise<Artifact | null> {
    return this.artifactRepo.findOneBy({ id });
  }

  async updateArtifact(id: string, data: Partial<Artifact>): Promise<void> {
    await this.artifactRepo.update(id, data);
  }

  async update(
    id: string,
    data: Partial<RepositoryEntity>,
  ): Promise<RepositoryEntity | null> {
    // support id or name
    const ent = await this.findOne(id);
    if (!ent) return null;
    Object.assign(ent, data as any);
    return this.repo.save(ent);
  }
  async delete(id: string): Promise<void> {
    // accept uuid or name: resolve entity first then delete by primary id
    const ent = await this.findOne(id);
    if (!ent) return;

    let artifactsDeleted = 0;

    // Delete all artifacts associated with this repository first
    // to avoid foreign key constraint violations
    try {
      const artifacts = await this.artifactRepo.find({
        where: { repositoryId: ent.id },
      });

      artifactsDeleted = artifacts.length;

      if (artifacts.length > 0) {
        this.logger.log(
          `Deleting ${artifacts.length} artifacts for repository ${ent.name}`,
        );
        await this.artifactRepo.remove(artifacts);
      }
    } catch (err) {
      this.logger.error(
        `Failed to delete artifacts for repository ${ent.name}: ${err.message}`,
      );
      throw err;
    }

    // Delete all physical files in storage for this repository
    // Storage keys typically follow pattern: <manager>/<repoName>/... or <manager>/<repoId>/...
    try {
      const manager = ent.manager || 'generic';
      const prefixes = [`${manager}/${ent.name}`, `${manager}/${ent.id}`];

      for (const storagePrefix of prefixes) {
        this.logger.log(
          `Deleting storage files for repository ${ent.name} (prefix: ${storagePrefix})`,
        );

        const files = await this.storage.list(storagePrefix);
        this.logger.log(`Found ${files.length} files to delete in ${storagePrefix}`);

        for (const fileKey of files) {
          try {
            await this.storage.delete(fileKey);
          } catch (err) {
            this.logger.warn(
              `Failed to delete storage file ${fileKey}: ${err.message}`,
            );
            // Continue with other files even if one fails
          }
        }
      }
    } catch (err) {
      this.logger.error(
        `Failed to delete storage files for repository ${ent.name}: ${err.message}`,
      );
      // Don't throw - continue with repository deletion even if storage cleanup fails
    }

    await this.repo.delete(ent.id);

    await this.auditService
      .logSuccess({
        action: 'repository.delete',
        entityType: 'repository',
        entityId: ent.id,
        details: { name: ent.name, artifactsDeleted },
      })
      .catch(() => { });
  }

  async listPackages(repoId: string) {
    const repo = await this.findOne(repoId);
    if (!repo) return [];

    // Fetch DB artifacts first to merge metadata (like size)
    const dbArtifacts = await this.artifactRepo.find({
      where: { repositoryId: repo.id },
      order: { createdAt: 'DESC' },
    });

    const dbMap = new Map<string, any>();
    for (const art of dbArtifacts) {
      if (art.packageName && !dbMap.has(art.packageName)) {
        dbMap.set(art.packageName, art);
      }
    }

    // Delegate to plugin if it supports listing packages (e.g. Docker)
    const plugin = this.pluginManager.getPluginForRepo(repo);
    if (plugin && typeof (plugin as any).listPackages === 'function') {
      try {
        const res = await (plugin as any).listPackages(repo);
        if (res && res.ok && Array.isArray(res.packages)) {
          // Merge DB info (size) into plugin results
          return res.packages.map((pkg: any) => {
            const dbArt = dbMap.get(pkg.name);
            if (dbArt) {
              return {
                ...pkg,
                size: dbArt.size,
                // If plugin didn't provide version, maybe use DB?
                // But plugin usually knows better about versions.
              };
            }
            return pkg;
          });
        }
      } catch (e) {
        this.logger.warn(
          `Plugin listPackages failed for ${repo.name}: ${e.message}`,
        );
      }
    }

    const map = new Map<string, any>();
    for (const art of dbArtifacts) {
      if (!art.packageName) continue;
      if (!map.has(art.packageName)) {
        map.set(art.packageName, {
          name: art.packageName,
          latestVersion: art.version,
          updatedAt: art.createdAt,
          size: art.size,
        });
      }
    }
    return Array.from(map.values());
  }

  /**
   * Return artifacts (versions) for a package name in a repository,
   * including a storage URL (when the storage backend provides one).
   */
  async getPackageDetails(repoId: string, packageName: string) {
    const repo = await this.findOne(repoId);
    if (!repo) return { ok: false, message: 'repo not found' };

    // Delegate to plugin if it supports getting package details (e.g. Docker)
    const pluginInst = this.pluginManager.getPluginForRepo(repo);
    if (pluginInst && typeof (pluginInst as any).getPackage === 'function') {
      try {
        return await (pluginInst as any).getPackage(repo, packageName);
      } catch (e) {
        this.logger.warn(
          `Plugin getPackage failed for ${repo.name}: ${e.message}`,
        );
      }
    }

    const artifacts = await this.artifactRepo.find({
      where: { repositoryId: repo.id, packageName },
      order: { createdAt: 'DESC' },
    });

    const out = [] as any[];
    const plugin = this.plugins.getInstance(repo.manager);

    for (const a of artifacts) {
      let url: string | null = null;
      try {
        if (a.storageKey && this.storage)
          url = await this.storage.getUrl(a.storageKey);
      } catch (err) {
        // ignore storage URL errors and continue returning artifact info
      }

      let installCommands: any[] = [];
      if (plugin && typeof (plugin as any).getInstallCommand === 'function') {
        try {
          const result = await (plugin as any).getInstallCommand(repo, {
            name: a.packageName,
            version: a.version,
          });

          if (Array.isArray(result)) {
            installCommands = result;
          } else if (typeof result === 'string') {
            installCommands = [{ label: 'Default', command: result, language: 'text' }];
          }
        } catch (e) {
          /* ignore */
        }
      }

      out.push({
        id: a.id,
        packageName: a.packageName,
        version: a.version,
        storageKey: a.storageKey,
        size: a.size,
        metadata: a.metadata,
        createdAt: a.createdAt,
        url,
        installCommands,
        // Keep for backward compatibility if needed, though we prefer the array
        installCommand: installCommands.length > 0 ? installCommands[0].command : null,
      });
    }

    return { ok: true, artifacts: out };
  }

  /** Delete a specific package version/artifact and remove the storage object (best-effort). */
  async deletePackageVersion(
    repoId: string,
    packageName: string,
    version: string,
  ) {
    const repo = await this.findOne(repoId);
    if (!repo) return { ok: false, message: 'repo not found' };

    // Delegate to plugin if it supports deleting package versions (e.g. Docker)
    const pluginInst = this.pluginManager.getPluginForRepo(repo);
    if (
      pluginInst &&
      typeof (pluginInst as any).deletePackageVersion === 'function'
    ) {
      try {
        return await (pluginInst as any).deletePackageVersion(
          repo,
          packageName,
          version,
        );
      } catch (e) {
        this.logger.warn(
          `Plugin deletePackageVersion failed for ${repo.name}: ${e.message}`,
        );
      }
    }

    const art = await this.artifactRepo.findOne({
      where: { repositoryId: repo.id, packageName, version },
    });
    if (!art) return { ok: false, message: 'artifact not found' };

    try {
      if (art.storageKey && this.storage) {
        await this.storage.delete(art.storageKey).catch(() => {
          // ignore storage deletion errors and continue with DB cleanup
        });
      }
    } catch (err) {
      // swallow
    }

    await this.artifactRepo.delete({ id: art.id });

    await this.auditService
      .logSuccess({
        action: 'artifact.delete',
        entityType: 'artifact',
        entityId: art.id,
        details: { repositoryId: repoId, packageName, version },
      })
      .catch(() => { });

    return { ok: true };
  }

  async scanArtifacts() {
    const repos = await this.repo.find({ where: { type: 'hosted' } });
    let total = 0;
    for (const r of repos) {
      const res = await this.scanRepoArtifacts(r);
      if (res.ok && res.count) total += res.count;
    }
    return { count: total };
  }

  async scanRepoArtifacts(repo: RepositoryEntity) {
    const manager = repo.manager;
    if (!manager) return { ok: false, message: 'unknown manager' };

    // Use storage adapter to list files
    const adapter = await this.storage.getAdapterForId(repo.config?.storageId);
    if (!adapter || typeof adapter.list !== 'function') {
      return { ok: false, message: 'storage adapter does not support listing' };
    }

    // Scan both name-based (legacy) and id-based (new) paths
    // Note: adapter.list(prefix) returns keys relative to storage root
    // e.g. manager/repoName/path/to/file
    const prefixes = [
      `${manager}/${repo.name}`,
      `${manager}/${repo.id}`,
    ];

    let count = 0;

    for (const prefix of prefixes) {
      try {
        const files = await adapter.list(prefix);
        for (const fileKey of files) {
          // fileKey is full key: manager/repoName/path/to/file
          // we need relative path inside repo: path/to/file
          if (!fileKey.startsWith(prefix + '/')) continue;
          const relPath = fileKey.substring(prefix.length + 1);

          if (manager === 'maven') {
            if (relPath.endsWith('.pom') || relPath.endsWith('.jar')) {
              // Expected: groupId/artifactId/version/file
              const parts = relPath.split('/');
              if (parts.length >= 3) {
                const version = parts[parts.length - 2];
                const artifactId = parts[parts.length - 3];
                const groupParts = parts.slice(0, parts.length - 3);
                const groupId = groupParts.join('.');
                const pkgName = `${groupId}:${artifactId}`;
                await this.ensureArtifact(repo, manager, pkgName, version, fileKey);
                count++;
              }
            }
          } else if (manager === 'npm') {
            if (relPath.endsWith('.tgz')) {
              // Expected: pkgName/-/file.tgz or @scope/pkgName/-/file.tgz
              const parts = relPath.split('/');
              if (parts.includes('-')) {
                const dashIndex = parts.lastIndexOf('-');
                if (dashIndex > 0) {
                  const pkgName = parts.slice(0, dashIndex).join('/');
                  const filename = parts[parts.length - 1];
                  const namePart = pkgName.split('/').pop() || '';
                  if (filename.startsWith(namePart + '-')) {
                    const verExt = filename.substring(namePart.length + 1);
                    const version = verExt.replace('.tgz', '');
                    await this.ensureArtifact(repo, manager, pkgName, version, fileKey);
                    count++;
                  }
                }
              }
            }
          } else if (manager === 'docker') {
            // Skip docker
          } else {
            // Default simple scan (depth 2: package/version)
            // relPath: package/version/file
            const parts = relPath.split('/');
            if (parts.length >= 2) {
              const pkgName = parts[0];
              const version = parts[1];
              await this.ensureArtifact(repo, manager, pkgName, version, fileKey);
              count++;
            }
          }
        }
      } catch (err) {
        this.logger.warn(`Scan failed for ${prefix}: ${err.message}`);
      }
    }
    return { ok: true, count };
  }

  private async ensureArtifact(repo: RepositoryEntity, manager: string, pkgName: string, version: string, storageKey: string) {
    let size = 0;
    try {
      // We can't easily get size without fetching metadata or file
      // But we can try to get it from storage if adapter supports it
      // For now, leave 0 or try to fetch if critical
      // const adapter = await this.storage.getAdapterForId(repo.config?.storageId);
      // if (adapter && adapter.getMetadata) ...
    } catch (e) { }

    const existing = await this.artifactRepo.findOne({
      where: {
        repositoryId: repo.id,
        packageName: pkgName,
        version: version,
      },
    });

    if (!existing) {
      const art = this.artifactRepo.create({
        repository: repo,
        repositoryId: repo.id,
        manager: manager,
        packageName: pkgName,
        version: version,
        storageKey: storageKey,
        size: size,
        metadata: { name: pkgName, version: version },
        lastAccessedAt: new Date(),
      });
      await this.artifactRepo.save(art);
    }
  }

  async deletePath(repoId: string, pathPrefix: string) {
    const repo = await this.findOne(repoId);
    if (!repo) return { ok: false, message: 'repo not found' };

    // Find artifacts that match the path prefix
    // We look for exact match or starting with prefix + separator
    // Common separators: / (npm scopes), : (docker), . (java/maven often mapped to / in storage but . in name?)
    // Actually, in the DB packageName is stored as is.
    // If the user browses "com/example", the packageName might be "com.example.foo" (Maven) or "@scope/pkg" (NPM).
    // The frontend tree builder splits by / : @.
    // So "com" matches the start of "com.example" if we split by dot?
    // The frontend splits by `/[/:@]/`.
    // So if I delete "com", I expect to delete "com.example..." and "com/foo...".

    // This is tricky because the mapping is lossy.
    // But let's assume the user wants to delete everything that *starts* with that string,
    // ensuring a boundary check to avoid partial matches (e.g. deleting "te" shouldn't delete "test").

    // We can try to match `prefix` exactly OR `prefix` followed by any of the separators.

    const artifacts = await this.artifactRepo.find({
      where: { repositoryId: repo.id },
    });

    const toDelete = artifacts.filter((a) => {
      const name = a.packageName;
      if (!name) return false;
      if (name === pathPrefix) return true;
      if (name.startsWith(pathPrefix + '/')) return true;
      if (name.startsWith(pathPrefix + ':')) return true;
      if (name.startsWith(pathPrefix + '@')) return true;
      if (name.startsWith(pathPrefix + '.')) return true; // Maven style?
      return false;
    });

    for (const art of toDelete) {
      if (art.packageName && art.version) {
        await this.deletePackageVersion(repoId, art.packageName, art.version);
      }
    }

    return { ok: true, count: toDelete.length };
  }

  async verify(repoId: string, artifactPath: string) {
    const repo = await this.repo.findOne({ where: { id: repoId } });
    if (!repo) throw new Error('Repository not found');

    // Try to find by path first (newly added field)
    let artifact = await this.artifactRepo.findOne({
      where: { repositoryId: repoId, path: artifactPath },
    });

    // Fallback to storageKey if not found by path
    if (!artifact) {
      // Try searching by storageKey directly (some plugins use path as storageKey)
      artifact = await this.artifactRepo.findOne({
        where: { repositoryId: repoId, storageKey: artifactPath },
      });
    }

    if (!artifact) {
      throw new Error('Artifact not found in database');
    }

    if (!artifact.contentHash) {
      return {
        ok: false,
        message: 'No hash stored for this artifact. Cannot verify.',
      };
    }

    // Calculate current hash using the storage abstraction
    const { stream } = await this.storage.getStream(artifact.storageKey);
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');

    for await (const chunk of stream) {
      hash.update(chunk);
    }

    const currentHash = hash.digest('hex');
    const match = currentHash === artifact.contentHash;

    return {
      ok: true,
      match,
      storedHash: artifact.contentHash,
      currentHash,
      algorithm: 'sha256',
    };
  }

  async attachProvenance(repoId: string, artifactPath: string, provenance: any) {
    const repo = await this.repo.findOne({ where: { id: repoId } });
    if (!repo) throw new Error('Repository not found');

    // Try to find by path first
    let artifact = await this.artifactRepo.findOne({
      where: { repositoryId: repoId, path: artifactPath },
    });

    // Fallback to storageKey
    if (!artifact) {
      artifact = await this.artifactRepo.findOne({
        where: { repositoryId: repoId, storageKey: artifactPath },
      });
    }

    if (!artifact) throw new Error('Artifact not found');

    artifact.metadata = {
      ...(artifact.metadata || {}),
      provenance: {
        ...(artifact.metadata?.provenance || {}),
        ...provenance,
        attachedAt: new Date().toISOString(),
      },
    };

    await this.artifactRepo.save(artifact);

    return { ok: true, message: 'Provenance attached' };
  }
}
