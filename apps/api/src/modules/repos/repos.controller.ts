import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
  Logger,
  Delete,
  BadRequestException,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ReposService } from './repos.service';
import { RepositoryPermissionService } from './repository-permission.service';
import { PluginManagerService } from '../plugins/plugin-manager.service';
import { Permissions } from '../rbac/permissions.decorator';
import { UnifiedPermissionGuard } from '../rbac/unified-permission.guard';
import { PermissionService } from '../rbac/permission.service';
import { RepositoryPermission } from './repository-permission.decorator';
import { RepositoryEntity } from '../../entities/repository.entity';
import { User } from '../../entities/user.entity';
import { UsersService } from '../users/users.service';
import { AuthService } from '../auth/auth.service';

// expose endpoints under both /repository and /repositories for backward compatibility
@Controller(['repository', 'repositories'])
export class ReposController {
  private readonly logger = new Logger(ReposController.name);
  constructor(
    private readonly repos: ReposService,
    private readonly pluginManager: PluginManagerService,
    private readonly repositoryPermissionService: RepositoryPermissionService,
    private readonly permissionService: PermissionService,
    private users: UsersService,
    private auth: AuthService,
  ) { }

  @Get()
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  async list(@Req() req: any) {

    try {
      const repos = await this.repos.findAll();
      const user = req.user;




      // Enrich each repository with the user's permission level using unified service
      if (user && user.id) {
        const enrichedRepos = await Promise.all(
          repos.map(async (repo) => {
            const userPermission =
              await this.permissionService.getUserRepositoryPermission(
                user.id,
                repo.id,
              );
            return { ...repo, userPermission };
          }),
        );


        return enrichedRepos;
      }


      return repos;
    } catch (err: any) {
      // During startup DB might not yet be available — return an empty list (200) so e2e
      // readiness checks can proceed and tests can create repositories.
      console.error('[REPOS LIST] Error:', err?.message || String(err));
      this.logger.warn(
        'list /repository failed: ' + (err?.message || String(err)),
      );
      return [];
    }
  }

  @Post()
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  async create(@Body() body: Partial<RepositoryEntity>) {
    // support docker-specific config right in repo creation
    // if manager is docker and no config provided, ensure a docker sub-config exists
    try {
      const manager = (body.manager || '').toLowerCase();
      if (manager === 'docker') {
        body.config = body.config || {};
        // normalize docker config container
        const dockerCfg = body.config.docker || {};
        // default version to v2
        dockerCfg.version = dockerCfg.version || 'v2';
        // allow providing a port, otherwise leave undefined so runtime can pick default
        if (!dockerCfg.port) dockerCfg.port = dockerCfg.port || undefined;
        body.config.docker = dockerCfg;
      } else if (manager === 'nuget') {
        body.config = body.config || {};
        const nugetCfg = body.config.nuget || {};
        // allow selecting nuget protocol version: v2 or v3 (default to v3)
        nugetCfg.version = (nugetCfg.version || 'v3').toString().toLowerCase();
        body.config.nuget = nugetCfg;
      }
    } catch {
      // on any error, still proceed with the create; validation can be handled elsewhere
    }
    // For proxy repositories we require a configured upstream URL. The value
    // can be provided directly in config (e.g. config.target) or nested
    // under a plugin-specific key (e.g. config.nuget.upstream). We consider
    // a repository valid only if one of the known upstream keys is present
    // and truthy in the config object.
    const isProxy = (body.type || '').toString().toLowerCase() === 'proxy';
    if (isProxy) {
      const hasUpstream = (obj: any): boolean => {
        if (!obj || typeof obj !== 'object') return false;
        for (const k of Object.keys(obj)) {
          if (
            [
              'target',
              'registry',
              'upstream',
              'indexUrl',
              'proxyUrl',
              'url',
            ].includes(k) &&
            obj[k] &&
            String(obj[k]).trim()
          )
            return true;
          if (typeof obj[k] === 'object') {
            if (hasUpstream(obj[k])) return true;
          }
        }
        return false;
      };

      if (!hasUpstream(body.config)) {
        throw new BadRequestException(
          'proxy repositories require a proxy URL in config (e.g. config.target or config.<plugin>.proxyUrl)',
        );
      }
    }

    // Validate Docker port is not already in use
    if (
      (body.manager || '').toLowerCase() === 'docker' &&
      body.config?.docker?.port
    ) {
      const requestedPort = body.config.docker.port;
      const existingRepos = await this.repos.findAll();
      const portInUse = existingRepos.some(
        (r) =>
          (r.manager || '').toLowerCase() === 'docker' &&
          r.config?.docker?.port === requestedPort,
      );
      if (portInUse) {
        throw new BadRequestException(
          `Port ${requestedPort} is already in use by another Docker repository. Please choose a different port.`,
        );
      }
    }

    const saved = await this.repos.create(body);

    // If this is a docker-managed repo, attempt to start a per-repo registry (plugin may choose port/version)
    try {
      if ((saved.manager || '').toLowerCase() === 'docker') {
        const inst = this.pluginManager.getPluginForRepo(saved as any);
        if (inst && typeof inst.startRegistryForRepo === 'function') {
          // prefer explicitly provided docker config under saved.config.docker
          const provided = saved.config?.docker ?? saved.config ?? {};
          // Apply default port=0 if not specified (0 means auto-select ephemeral port once, then persist)
          const port = provided.port !== undefined ? provided.port : 0;
          // Build repos map for group resolution
          const allRepos = await this.repos.findAll();
          const reposById = new Map();
          for (const r of allRepos) {
            reposById.set(r.id, r);
            reposById.set(r.name, r);
          }
          const opts = {
            port,
            version: provided.version,
            pluginManager: this.pluginManager,
            reposById,
          };
          try {
            const out: any = await inst.startRegistryForRepo(
              saved as any,
              opts,
            );
            if (out?.ok && out.port) {
              // persist generated port and version back to repo config
              const newCfg = {
                ...(saved.config ?? {}),
                docker: {
                  ...(saved.config?.docker ?? {}),
                  port: out.port,
                  version: provided.version || out.version || 'v2',
                  accessUrl: out.accessUrl ?? saved.config?.docker?.accessUrl,
                },
              };
              await this.repos.update(saved.id, { config: newCfg } as any);
              // reflect change in returned value
              saved.config = newCfg;
            }
          } catch (err) {
            // console.error('[DEBUG] Error starting registry:', err);
            // don't fail creation if plugin registry fails; log can be added later
          }
        }
      }
    } catch (err) {
      // tolerate any plugin errors — repo creation still succeeds
    }

    return saved;
  }

  @Get(':id')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async get(@Param('id') id: string, @Req() req: any) {
    const repo = await this.repos.findOne(id);
    if (!repo) return null;

    const user = req.user;
    if (!user || !user.id) return repo;

    // Get user's permission level using unified service
    const userPermission =
      await this.permissionService.getUserRepositoryPermission(
        user.id,
        repo.id,
      );

    return { ...repo, userPermission };
  }

  // Trigger an immediate upstream ping for a repository (non-blocking for UI flows)
  @Get(':id/ping')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async pingRepo(@Param('id') id: string) {
    const ent = await this.repos.findOne(id);
    if (!ent) return { ok: false, message: 'not found' };

    return await this.pluginManager.triggerUpstreamPingForRepo(ent);
  }

  // Repository metadata: secure, read-only details aggregating config, capabilities and audit
  @Get(':id/metadata')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async metadata(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    const manager = (r.manager || '').toLowerCase();
    const plugin = this.pluginManager.getPluginForRepo(r);
    const capabilities = {
      supportsPull: manager === 'docker' || manager === 'nuget',
      supportsPush: manager === 'docker' || manager === 'nuget',
    };
    // Basic audit placeholders; plugins can enrich via their own state
    const audit = {
      lastRead: r?.audit?.lastRead || null,
      lastWrite: r?.audit?.lastWrite || null,
    };
    const state = {
      health: r?.state?.health || 'unknown',
      lastErrors: r?.state?.lastErrors || [],
    };
    const schema =
      (plugin && plugin.metadata && (plugin.metadata as any).configSchema) ||
      {};
    return {
      ok: true,
      id: r.id,
      type: r.type,
      manager: r.manager,
      config: r.config,
      capabilities,
      audit,
      state,
      schema,
    };
  }

  // Repository members (for group-type repos): secure, read-only
  @Get(':id/members')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async members(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    const cfg = r.config || {};
    const memberIds: string[] = Array.isArray(cfg.members) ? cfg.members : [];
    const out: any[] = [];
    for (const mid of memberIds) {
      const m = await this.repos.findOne(mid);
      if (m)
        out.push({ id: m.id, name: m.name, type: m.type, manager: m.manager });
    }
    return { ok: true, members: out };
  }

  @Put(':id')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async update(
    @Param('id') id: string,
    @Body() body: Partial<RepositoryEntity>,
  ) {
    // Validate Docker port change if applicable
    const existingRepo = await this.repos.findOne(id);
    if (!existingRepo) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    if (
      (existingRepo.manager || '').toLowerCase() === 'docker' &&
      body.config?.docker?.port
    ) {
      const requestedPort = body.config.docker.port;
      const currentPort = existingRepo.config?.docker?.port;

      // Only validate if port is actually changing
      if (requestedPort !== currentPort) {
        const existingRepos = await this.repos.findAll();
        const portInUse = existingRepos.some(
          (r) =>
            r.id !== id &&
            (r.manager || '').toLowerCase() === 'docker' &&
            r.config?.docker?.port === requestedPort,
        );
        if (portInUse) {
          throw new BadRequestException(
            `Port ${requestedPort} is already in use by another Docker repository. Please choose a different port.`,
          );
        }

        // Stop the current registry before updating (will restart on next access or explicitly)
        const inst = this.pluginManager.getPluginForRepo(existingRepo);
        if (inst && typeof inst.stopRegistryForRepo === 'function') {
          await inst.stopRegistryForRepo(existingRepo);
        }
      }
    }

    // allow partial updates (e.g., config modifications) — delegate to service
    const updated = await this.repos.update(id, body as any);

    // Some Docker registries keep repository config in-memory (e.g. group routing).
    // If config changes but port doesn't, we still need to restart the registry so
    // the new config takes effect.
    const isDocker = (existingRepo.manager || '').toLowerCase() === 'docker';
    const requestedPort = body.config?.docker?.port;
    const portUnchanged =
      requestedPort === undefined ||
      requestedPort === existingRepo.config?.docker?.port;
    const dockerConfigTouched =
      body.config !== undefined &&
      (Object.prototype.hasOwnProperty.call(body.config as any, 'members') ||
        Object.prototype.hasOwnProperty.call(body.config as any, 'writePolicy') ||
        Object.prototype.hasOwnProperty.call(body.config as any, 'preferredWriter'));
    if (updated && isDocker && portUnchanged && dockerConfigTouched) {
      const inst = this.pluginManager.getPluginForRepo(updated as any);
      if (inst && typeof inst.startRegistryForRepo === 'function') {
        if (typeof inst.stopRegistryForRepo === 'function') {
          await inst.stopRegistryForRepo(updated as any);
        }

        const allRepos = await this.repos.findAll();
        const reposById = new Map<string, any>();
        allRepos.forEach((r) => reposById.set(r.id, r));

        const provided = updated.config?.docker ?? updated.config ?? {};
        const port =
          provided.port !== undefined
            ? provided.port
            : existingRepo.config?.docker?.port ?? 0;
        const opts = {
          port,
          version: provided.version,
          pluginManager: this.pluginManager,
          reposById,
        };
        const out: any = await inst.startRegistryForRepo(updated as any, opts);

        if (out?.ok && out.needsPersistence && out.port) {
          const newCfg = {
            ...(updated.config ?? {}),
            docker: {
              ...(updated.config?.docker ?? {}),
              port: out.port,
              accessUrl: out.accessUrl,
            },
          };
          await this.repos.update(id, { config: newCfg } as any);
          updated.config = newCfg;
        }
      }
    }

    // If Docker port changed, restart registry with new port
    if (
      updated &&
      isDocker &&
      body.config?.docker?.port !== undefined &&
      body.config.docker.port !== existingRepo.config?.docker?.port
    ) {
      const inst = this.pluginManager.getPluginForRepo(updated as any);
      if (inst && typeof inst.startRegistryForRepo === 'function') {
        // Stop existing registry first
        if (typeof inst.stopRegistryForRepo === 'function') {
          await inst.stopRegistryForRepo(updated as any);
        }

        const allRepos = await this.repos.findAll();
        const reposById = new Map<string, any>();
        allRepos.forEach((r) => reposById.set(r.id, r));

        const provided = updated.config?.docker ?? updated.config ?? {};
        // Apply default port=0 if not specified (0 means auto-select ephemeral port once, then persist)
        const port = provided.port !== undefined ? provided.port : 0;
        const opts = {
          port,
          version: provided.version,
          pluginManager: this.pluginManager,
          reposById,
        };
        const out: any = await inst.startRegistryForRepo(updated as any, opts);

        // If port was auto-selected, persist it
        if (out?.ok && out.needsPersistence && out.port) {
          const newCfg = {
            ...(updated.config ?? {}),
            docker: {
              ...(updated.config?.docker ?? {}),
              port: out.port,
              accessUrl: out.accessUrl,
            },
          };
          await this.repos.update(id, { config: newCfg } as any);
          updated.config = newCfg;
        }
      }
    }

    return updated;
  }

  @Post(':id/migrate-storage')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async migrateStorage(
    @Param('id') id: string,
    @Body() body: { newStorageId: string | null },
  ) {
    const repo = await this.repos.findOne(id);
    if (!repo) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    const oldStorageId = repo.config?.storageId || null;
    const newStorageId = body.newStorageId || null;

    if (oldStorageId === newStorageId) {
      return {
        ok: true,
        message: 'Storage is already set to the requested configuration',
      };
    }

    // Get the storage service
    const storageService = this.repos['storageService'];
    if (!storageService) {
      throw new Error('Storage service not available');
    }

    // Determine the prefixes for this repository's files
    const manager = (repo.manager || 'generic').toLowerCase();
    const prefixes = [`${manager}/${repo.name}`, `${manager}/${repo.id}`];

    this.logger.log(
      `Starting storage migration for ${repo.name} from ${oldStorageId || 'default'} to ${newStorageId || 'default'}`,
    );

    try {
      // Perform the migration for all possible prefixes
      for (const prefix of prefixes) {
        await storageService.migrate(prefix, oldStorageId, newStorageId);
      }

      // Update the repository config with the new storage ID
      const updatedConfig = {
        ...(repo.config || {}),
        storageId: newStorageId,
      };

      await this.repos.update(id, { config: updatedConfig } as any);

      this.logger.log(`Storage migration completed for ${repo.name}`);

      return {
        ok: true,
        message: `Storage migrated successfully from ${oldStorageId || 'default'} to ${newStorageId || 'default'}`,
      };
    } catch (err: any) {
      this.logger.error(
        `Storage migration failed for ${repo.name}: ${err.message}`,
      );
      throw new BadRequestException(`Storage migration failed: ${err.message}`);
    }
  }

  @Post(':id/upload')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.write')
  @RepositoryPermission('write')
  async upload(@Param('id') id: string, @Body() body: any, @Req() req?: any) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    // docker repositories are expected to be served on a dedicated registry port
    if ((r.manager || '').toLowerCase() === 'docker') {
      return {
        ok: false,
        message:
          'docker repositories should be accessed through the registry host:port (not via /repository). Use the configured docker registry endpoint.',
      };
    }
    const userId = req?.user?.id;
    return this.pluginManager.upload(r, body, userId);
  }



  @Post(':id/scan')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async scan(@Param('id') id: string) {
    const repo = await this.repos.findOne(id);
    if (!repo) throw new NotFoundException('Repository not found');
    return this.repos.scanRepoArtifacts(repo as any);
  }

  @Get(':id/artifacts/:artifactId/verify')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async verifyArtifact(
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
  ) {
    const repo = await this.repos.findOne(id);
    if (!repo) throw new NotFoundException('Repository not found');

    const artifact = await this.repos.findArtifactById(artifactId);
    if (!artifact || artifact.repositoryId !== id) {
      throw new NotFoundException('Artifact not found');
    }

    if (!artifact.contentHash) {
      return { ok: false, message: 'Artifact has no content hash to verify' };
    }

    try {
      const { stream } = await this.repos['storageService'].getStream(
        artifact.storageKey,
      );
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256');

      for await (const chunk of stream) {
        hash.update(chunk);
      }

      const computed = hash.digest('hex');
      const match = computed === artifact.contentHash;

      return {
        ok: true,
        match,
        computed,
        expected: artifact.contentHash,
      };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  @Post(':id/artifacts/:artifactId/provenance')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.write')
  @RepositoryPermission('write')
  async attachProvenance(
    @Param('id') id: string,
    @Param('artifactId') artifactId: string,
    @Body() body: { commitSha?: string; buildId?: string; sourceRepoUrl?: string },
  ) {
    const repo = await this.repos.findOne(id);
    if (!repo) throw new NotFoundException('Repository not found');

    const artifact = await this.repos.findArtifactById(artifactId);
    if (!artifact || artifact.repositoryId !== id) {
      throw new NotFoundException('Artifact not found');
    }

    await this.repos.updateArtifact(artifactId, {
      commitSha: body.commitSha,
      buildId: body.buildId,
      sourceRepoUrl: body.sourceRepoUrl,
    } as any);

    return { ok: true, message: 'Provenance attached' };
  }

  @Get(':id/packages')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async listPackages(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, packages: [] };
    const packages = await this.repos.listPackages(id);
    return { ok: true, packages };
  }

  @Get(':id/packages/:name/versions')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async listVersions(@Param('id') id: string, @Param('name') name: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, versions: [] };
    // if ((r.manager || '').toLowerCase() === 'docker')
    //   return { ok: false, versions: [] };
    return this.pluginManager.listVersions(r, name);
  }

  @Get(':id/packages/:name')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async packageDetails(@Param('id') id: string, @Param('name') name: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    // if ((r.manager || '').toLowerCase() === 'docker')
    //   return { ok: false, message: 'docker package listing not supported' };

    return this.repos.getPackageDetails(id, decodeURIComponent(name));
  }

  @Delete(':id/packages/:name/:version')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async deletePackageVersion(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('version') version: string,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    // if ((r.manager || '').toLowerCase() === 'docker')
    //   return { ok: false, message: 'docker package deletion not supported' };

    return this.repos.deletePackageVersion(
      id,
      decodeURIComponent(name),
      decodeURIComponent(version),
    );
  }

  @Delete(':id/path')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async deletePath(@Param('id') id: string, @Query('prefix') prefix: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    if (!prefix) return { ok: false, message: 'prefix required' };

    return this.repos.deletePath(id, prefix);
  }

  @Get(':id/download')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async download(
    @Param('id') id: string,
    @Body() body: { packageName: string; version?: string },
    @Query() query: { packageName?: string; version?: string },
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false };
    // if ((r.manager || '').toLowerCase() === 'docker')
    //   return {
    //     ok: false,
    //     message:
    //       'docker repositories are served on a dedicated registry port; use the registry host:port to download blobs/manifests',
    //   };
    const userId = req?.user?.id;
    const pkgName = body.packageName || query.packageName;
    const pkgVer = body.version || query.version;

    if (!pkgName) return { ok: false, message: 'packageName required' };

    return this.pluginManager.download(
      r,
      pkgName,
      pkgVer,
      new Set(),
      userId,
    );
  }

  @Get(':id/proxy')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async proxy(
    @Param('id') id: string,
    @Body() body: { url: string },
    @Query() query: { url?: string },
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false };
    // if ((r.manager || '').toLowerCase() === 'docker')
    //   return {
    //     ok: false,
    //     message:
    //       'docker repositories are served on a dedicated registry port; proxy pulls should go to the registry host:port',
    //   };
    const targetUrl = body.url || query.url;
    if (!targetUrl) return { ok: false, message: 'url required' };
    return this.pluginManager.proxyFetch(r, targetUrl);
  }

  // Plugin-specific authentication endpoint (e.g. npm login, docker login)
  @Post(':id/auth')
  async pluginAuth(@Param('id') id: string, @Body() body: any) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    const res = await this.pluginManager.authenticate(r, body);

    // If plugin returned a user-like object, ensure a local user exists and return a JWT
    if (res?.ok && res.user && res.user.username) {
      let u: User | null = await this.users.findByUsername(res.user.username);
      if (!u) {
        // create local user record without password
        u = await this.users.create({
          username: res.user.username,
        });
      }
      // at this point u should be a valid User — defensive check before signing
      if (!u) return { ok: false, message: 'failed to create or find user' };
      const token = this.auth.signToken({ sub: u.id, username: u.username });
      return { ok: true, token, user: { id: u.id, username: u.username } };
    }

    return res;
  }

  // npm "adduser" / "login" compatibility endpoint
  @Post(':id/-/user/org.couchdb.user')
  async npmLogin(@Param('id') id: string, @Body() body: any) {
    // body expected to contain { name, password, email } when using npm adduser
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    if ((r.manager || '').toLowerCase() === 'docker')
      return {
        ok: false,
        message:
          'docker repositories expose npm-style auth via the registry host:port',
      };

    const res = await this.pluginAuth(id, body);
    // npm expects { ok: true } or user doc — provide token for clients
    if (res?.ok && res.token) return { ok: true };
    return res;
  }

  // MOVED TO TOP
  // @Get(':id/v2/token')
  // @Post(':id/v2/token')

  @Delete(':id')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async delete(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };

    // Stop registry server if this is a docker repo
    if ((r.manager || '').toLowerCase() === 'docker') {
      const inst = this.pluginManager.getPluginForRepo(r);
      if (inst && typeof inst.stopRegistryForRepo === 'function') {
        const stopResult = await inst.stopRegistryForRepo(r);

      }
    }

    await this.repos.delete(id);
    return { ok: true };
  }

  // ============================================
  // Repository Permission Management Endpoints
  // ============================================

  @Get(':id/permissions')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async getRepositoryPermissions(@Param('id') id: string) {
    try {
      const result =
        await this.repositoryPermissionService.getRepositoryPermissions(id);
      return result;
    } catch (err) {
      // console.error('[GET PERMISSIONS] Error:', err);
      throw err;
    }
  }

  @Post(':id/permissions/user')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async grantUserPermission(
    @Param('id') id: string,
    @Body() body: { userId: string; permission: 'read' | 'write' | 'admin' },
  ) {
    return this.repositoryPermissionService.grantUserPermission(
      id,
      body.userId,
      body.permission,
    );
  }

  @Post(':id/permissions/role')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async grantRolePermission(
    @Param('id') id: string,
    @Body() body: { roleId: string; permission: 'read' | 'write' | 'admin' },
  ) {
    return this.repositoryPermissionService.grantRolePermission(
      id,
      body.roleId,
      body.permission,
    );
  }

  @Delete(':id/permissions/:permissionId')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async revokePermission(
    @Param('id') id: string,
    @Param('permissionId') permissionId: string,
  ) {
    return this.repositoryPermissionService.revokePermission(permissionId);
  }

  // ============================================
  // Proxy Cache Management Endpoints
  // ============================================

  @Delete(':id/cache')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async clearRepositoryCache(@Param('id') id: string) {
    const repo = await this.repos.findOne(id);
    if (!repo) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    if (repo.type !== 'proxy') {
      throw new BadRequestException(
        'Cache cleanup is only available for proxy repositories',
      );
    }

    // Clear in-memory cache
    const memoryCleared = await this.pluginManager.clearProxyCache(id);

    // Clean old files from storage
    const filesDeleted = await this.pluginManager.cleanupProxyCache(id);

    return {
      ok: true,
      message: `Cleared cache for repository ${repo.name}`,
      memoryCacheCleared: memoryCleared,
      filesDeleted,
    };
  }

  @Get(':id/cache/stats')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async getRepositoryCacheStats(@Param('id') id: string) {
    const repo = await this.repos.findOne(id);
    if (!repo) {
      throw new NotFoundException(`Repository ${id} not found`);
    }

    if (repo.type !== 'proxy') {
      throw new BadRequestException(
        'Cache statistics are only available for proxy repositories',
      );
    }

    const allStats = await this.pluginManager.getCacheStats();
    const repoStats = allStats.byRepository[id] || 0;

    return {
      ok: true,
      repositoryId: id,
      repositoryName: repo.name,
      cacheEntries: repoStats,
      cacheTtlSeconds: repo.config?.cacheTtlSeconds || 60,
      cacheMaxAgeDays: repo.config?.cacheMaxAgeDays || 7,
    };
  }

  @Get('cache/stats')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('system.admin')
  async getAllCacheStats() {
    const stats = await this.pluginManager.getCacheStats();
    return {
      ok: true,
      ...stats,
    };
  }

  @Post('cache/clear-all')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('system.admin')
  async clearAllProxyCache() {
    const cleared = await this.pluginManager.clearAllProxyCache();
    return {
      ok: true,
      message: `Cleared all ${cleared} proxy cache entries`,
      cleared,
    };
  }

  @Put(':id/*')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('write')
  async putArtifact(
    @Param('id') id: string,
    @Param() params: any,
    @Req() req: any,
  ) {
    const path = params[0] || params['0'] || (Array.isArray(params.path) ? params.path.join('/') : params.path);

    const r = req.repository || await this.repos.findOne(id);
    if (!r) throw new NotFoundException('Repository not found');

    const userId = req?.user?.id;
    try {
      return await this.pluginManager.handlePut(r, path, req, userId);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Get(':id/*')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async getArtifact(
    @Param('id') id: string,
    @Param() params: any,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const path = params[0] || (Array.isArray(params.path) ? params.path.join('/') : params.path);

    const r = req.repository || await this.repos.findOne(id);
    if (!r) return res.status(404).send('Not found');



    // If it's a proxy repo, delegate to proxyFetch
    if (r.type === 'proxy') {
      const result = await this.pluginManager.proxyFetch(r, path);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          // Skip headers that express/node handles automatically or that might cause issues
          if (['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) continue;
          res.setHeader(k, v as string);
        }
      }
      if (result.status) res.status(result.status);

      if (result.stream) {
        // Handle streaming response for large artifacts
        const stream = result.stream as any;
        if (typeof stream.pipe === 'function') {
          return stream.pipe(res);
        } else if (stream instanceof ReadableStream) {
          // Web Stream API (common in some fetch implementations)
          const nodeStream = require('stream').Readable.fromWeb(stream as any);
          return nodeStream.pipe(res);
        }
      }

      if (result.body) res.send(result.body);
      else res.end();
      return;
    }

    // If it's a hosted repo, delegate to download
    // For RawPlugin, we can use download(repo, path)
    if (r.manager === 'raw' || r.type === 'hosted' || r.type === 'group') {
      // We need to call plugin.download directly or via manager
      // PluginManager.download expects (repo, name, version)
      // But for raw, name is the path.
      const plugin = this.pluginManager.getPluginForRepo(r);
      if (plugin && typeof plugin.download === 'function') {
        const result = await plugin.download(r, path);
        if (result.ok && result.url) {
          // If it's a file:// url (local), we might want to stream it?
          // But StorageService.getUrl returns file:// for fs.
          // res.sendFile requires absolute path.
          if (result.url.startsWith('file://')) {
            const p = result.url.replace('file://', '');
            return res.sendFile(p);
          }
          return res.redirect(result.url);
        }
        if (result.ok && result.data) {
          if (result.contentType) res.setHeader('Content-Type', result.contentType);
          return res.send(result.data);
        }
      }
    }

    return res.status(404).send('Not found');
  }

  @Post(':id/verify/*')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async verifyArtifactByPath(
    @Param('id') id: string,
    @Param() params: any,
  ) {
    const path = params[0] || (Array.isArray(params.path) ? params.path.join('/') : params.path);
    try {
      return await this.repos.verify(id, path);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }

  @Post(':id/provenance/*')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.write')
  @RepositoryPermission('write')
  async attachProvenanceByPath(
    @Param('id') id: string,
    @Param() params: any,
    @Body() provenance: any,
  ) {
    const path = params[0] || (Array.isArray(params.path) ? params.path.join('/') : params.path);
    try {
      return await this.repos.attachProvenance(id, path, provenance);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }
}
