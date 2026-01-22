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
      return [];
    }
  }

  @Post()
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  async create(@Body() body: Partial<RepositoryEntity>) {
    const isProxy = (body.type || '').toString().toLowerCase() === 'proxy';
    if (isProxy && !this.repos.validateProxyConfig(body.config)) {
      throw new BadRequestException(
        'proxy repositories require a proxy URL in config (e.g. config.target or config.<plugin>.proxyUrl)',
      );
    }

    if (
      (body.manager || '').toLowerCase() === 'docker' &&
      body.config?.docker?.port
    ) {
      const isAvailable = await this.repos.validateDockerPortAvailability(
        body.config.docker.port,
      );
      if (!isAvailable) {
        throw new BadRequestException(
          `Port ${body.config.docker.port} is already in use by another Docker repository. Please choose a different port.`,
        );
      }
    }

    const saved = await this.repos.create(body);

    try {
      if ((saved.manager || '').toLowerCase() === 'docker') {
        const out = await this.repos.manageDockerRegistry(saved, 'start');
      }
    } catch (err) { }

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

    const userPermission =
      await this.permissionService.getUserRepositoryPermission(
        user.id,
        repo.id,
      );

    return { ...repo, userPermission };
  }

  @Get(':id/ping')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async pingRepo(@Param('id') id: string) {
    const ent = await this.repos.findOne(id);
    if (!ent) return { ok: false, message: 'not found' };

    return await this.pluginManager.triggerUpstreamPingForRepo(ent);
  }

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

      if (requestedPort !== currentPort) {
        const isAvailable = await this.repos.validateDockerPortAvailability(
          requestedPort,
          id,
        );
        if (!isAvailable) {
          throw new BadRequestException(
            `Port ${requestedPort} is already in use by another Docker repository. Please choose a different port.`,
          );
        }

        await this.repos.manageDockerRegistry(existingRepo, 'stop');
      }
    }

    const updated = await this.repos.update(id, body as any);

    const isDocker = (existingRepo.manager || '').toLowerCase() === 'docker';
    if (updated && isDocker) {
      const requestedPort = body.config?.docker?.port;
      const portUnchanged =
        requestedPort === undefined ||
        requestedPort === existingRepo.config?.docker?.port;
      const dockerConfigTouched =
        body.config !== undefined &&
        (Object.prototype.hasOwnProperty.call(body.config as any, 'members') ||
          Object.prototype.hasOwnProperty.call(
            body.config as any,
            'writePolicy',
          ) ||
          Object.prototype.hasOwnProperty.call(
            body.config as any,
            'preferredWriter',
          ));

      if (!portUnchanged || dockerConfigTouched) {
        await this.repos.manageDockerRegistry(updated, 'restart');
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

    const storageService = this.repos['storageService'];
    if (!storageService) {
      throw new Error('Storage service not available');
    }

    const manager = (repo.manager || 'generic').toLowerCase();
    const prefixes = [`${manager}/${repo.name}`, `${manager}/${repo.id}`];

    this.logger.log(
      `Starting storage migration for ${repo.name} from ${oldStorageId || 'default'} to ${newStorageId || 'default'}`,
    );

    try {
      for (const prefix of prefixes) {
        await storageService.migrate(prefix, oldStorageId, newStorageId);
      }

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
    return this.repos.scanRepoArtifacts(repo);
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
      const { stream } = (await this.repos.storageService.getStream(
        artifact.storageKey,
      )) as any;
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
    @Body()
    body: { commitSha?: string; buildId?: string; sourceRepoUrl?: string },
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

    return this.pluginManager.listVersions(r, name);
  }

  @Get(':id/packages/:name')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async packageDetails(@Param('id') id: string, @Param('name') name: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
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

    const userId = req?.user?.id;
    const pkgName = body.packageName || query.packageName;
    const pkgVer = body.version || query.version;

    if (!pkgName) return { ok: false, message: 'packageName required' };

    return this.pluginManager.download(r, pkgName, pkgVer, new Set(), userId);
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

    const targetUrl = body.url || query.url;
    if (!targetUrl) return { ok: false, message: 'url required' };
    return this.pluginManager.proxyFetch(r, targetUrl);
  }

  @Post(':id/auth')
  async pluginAuth(@Param('id') id: string, @Body() body: any) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    const res = await this.pluginManager.authenticate(r, body);

    if (res?.ok && res.user && res.user.username) {
      let u: User | null = await this.users.findByUsername(res.user.username);
      if (!u) {
        u = await this.users.create({
          username: res.user.username,
        });
      }
      if (!u) return { ok: false, message: 'failed to create or find user' };
      const token = this.auth.signToken({ sub: u.id, username: u.username });
      return { ok: true, token, user: { id: u.id, username: u.username } };
    }

    return res;
  }

  @Post(':id/-/user/org.couchdb.user')
  async npmLogin(@Param('id') id: string, @Body() body: any) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };
    if ((r.manager || '').toLowerCase() === 'docker')
      return {
        ok: false,
        message:
          'docker repositories expose npm-style auth via the registry host:port',
      };

    const res = await this.pluginAuth(id, body);
    if (res?.ok && res.token) return { ok: true };
    return res;
  }

  @Delete(':id')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.manage')
  @RepositoryPermission('admin')
  async delete(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false, message: 'not found' };

    if ((r.manager || '').toLowerCase() === 'docker') {
      await this.repos.manageDockerRegistry(r, 'stop');
    }

    await this.repos.delete(id);
    return { ok: true };
  }

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

    const memoryCleared = await this.pluginManager.clearProxyCache(id);

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
    const path =
      params[0] ||
      params['0'] ||
      (Array.isArray(params.path) ? params.path.join('/') : params.path);

    const r = req.repository || (await this.repos.findOne(id));
    if (!r) throw new NotFoundException('Repository not found');

    const userId = req?.user?.id;
    try {
      const result = await this.pluginManager.handlePut(r, path, req, userId);
      if (result && typeof result === 'object' && result.ok === false) {
        throw new BadRequestException(result.message || 'Artifact upload failed');
      }
      return result;
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
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
    const path =
      params[0] ||
      (Array.isArray(params.path) ? params.path.join('/') : params.path);

    const r = req.repository || (await this.repos.findOne(id));
    if (!r) return res.status(404).send('Not found');

    if (r.type === 'proxy') {
      const result: any = await this.pluginManager.proxyFetch(r, path);
      if (result.headers) {
        for (const [k, v] of Object.entries(result.headers)) {
          if (
            [
              'content-length',
              'content-encoding',
              'transfer-encoding',
              'connection',
            ].includes(k.toLowerCase())
          )
            continue;
          res.setHeader(k, v as string);
        }
      }
      if (result.status) res.status(result.status);

      if (result.stream) {
        const stream = result.stream as any;
        if (typeof stream.pipe === 'function') {
          return stream.pipe(res);
        } else if (stream instanceof ReadableStream) {
          const nodeStream = require('stream').Readable.fromWeb(stream as any);
          return nodeStream.pipe(res);
        }
      }

      if (result.body) res.send(result.body);
      else res.end();
      return;
    }

    if (r.manager === 'raw' || r.type === 'hosted' || r.type === 'group' || (r.manager === 'docker' && r.type === 'proxy')) {
      const plugin = this.pluginManager.getPluginForRepo(r);
      if (plugin) {
        if (typeof plugin.download === 'function') {
          const result = await plugin.download(r, path);
          if (result.ok && result.url) {
            if (result.url.startsWith('file://')) {
              const p = result.url.replace('file://', '');
              return res.sendFile(p);
            }
            return res.redirect(result.url);
          }
          if (result.ok && result.data) {
            if (result.contentType)
              res.setHeader('Content-Type', result.contentType);
            else if (r.manager === 'raw') {
              const mime = require('mime-types');
              const contentType = mime.lookup(path) || 'application/octet-stream';
              res.setHeader('Content-Type', contentType);
            }
            return res.send(result.data);
          }
        }

        // Fallback to generic request (e.g. for Docker /v2/token)
        const pluginResult: any = await this.pluginManager.request(r, {
          path: '/' + path,
          query: req.query,
          headers: req.headers,
          method: req.method,
        });

        if (pluginResult) {
          if (pluginResult.headers) {
            for (const [k, v] of Object.entries(pluginResult.headers)) {
              res.setHeader(k, v as string);
            }
          }
          if (pluginResult.status) res.status(pluginResult.status);
          return res.send(pluginResult.body);
        }
      }
    }

    return res.status(404).send('Not found');
  }

  @Post(':id/verify/*')
  @UseGuards(UnifiedPermissionGuard)
  @Permissions('repo.read')
  @RepositoryPermission('read')
  async verifyArtifactByPath(@Param('id') id: string, @Param() params: any) {
    const path =
      params[0] ||
      (Array.isArray(params.path) ? params.path.join('/') : params.path);
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
    const path =
      params[0] ||
      (Array.isArray(params.path) ? params.path.join('/') : params.path);
    try {
      return await this.repos.attachProvenance(id, path, provenance);
    } catch (err: any) {
      throw new BadRequestException(err.message);
    }
  }
}
