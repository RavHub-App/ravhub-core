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

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { LicenseService } from '../license/license.service';
import { RedlockService } from '../redis/redlock.service';
import { RepositoryEntity } from '../../entities/repository.entity';
import { ArtifactIndexService } from './artifact-index.service';

@Injectable()
export class PluginDelegatorService {
  private readonly logger = new Logger(PluginDelegatorService.name);

  constructor(
    private readonly plugins: PluginsService,
    private readonly licenseService: LicenseService,
    private readonly redlock: RedlockService,
    private readonly artifactIndex: ArtifactIndexService,
  ) {}

  getPluginForRepo(repo: RepositoryEntity) {
    const manager = (repo as any).manager || repo.config?.registry || 'npm';

    if (!this.licenseService.isFeatureEnabled(manager)) {
      this.logger.warn(
        `Feature ${manager} requested for repository ${repo.name} but is disabled by license`,
      );
      throw new UnauthorizedException(
        `Feature ${manager} is not enabled by your current license`,
      );
    }

    const found = this.plugins.list().find((m) => m.key === manager);
    if (!found) {
      this.logger.debug(`no plugin loaded for manager ${manager}`);
      return null;
    }
    return this.plugins.getInstance(manager);
  }

  async handlePut(
    repo: RepositoryEntity,
    path: string,
    req: any,
    userId?: string,
  ) {
    if (repo.type !== 'hosted' && repo.type !== 'group') {
      throw new Error('PUT only supported for hosted and group repositories');
    }
    if (!repo.manager) {
      throw new Error('Repository manager not configured');
    }
    const plugin = this.getPluginForRepo(repo);
    if (!plugin || typeof plugin.handlePut !== 'function') {
      throw new Error('Plugin does not support PUT');
    }

    const lockKey = `upload:repo:${repo.id}:path:${path}`;
    return this.redlock.runWithLock(lockKey, 30000, async () => {
      const result = await plugin.handlePut!(repo, path, req);

      if (result?.ok && result?.metadata) {
        this.artifactIndex
          .indexArtifact(repo, result, userId, path)
          .catch(() => {});
      }

      return result;
    });
  }

  async upload(repo: RepositoryEntity, pkg: any, userId?: string) {
    const plugin = this.getPluginForRepo(repo);
    if (!plugin) {
      return { ok: false, message: 'No plugin found for repository' };
    }

    if (typeof plugin.upload !== 'function') {
      return { ok: false, message: 'Plugin does not support upload' };
    }

    const lockKey = `upload:${repo.manager}:${pkg.name || 'unknown'}`;
    return this.redlock.runWithLock(lockKey, 30000, async () => {
      const result = await plugin.upload!(repo, pkg);

      if (result?.ok && result?.metadata) {
        this.artifactIndex.indexArtifact(repo, result, userId).catch(() => {});
      }

      return result;
    });
  }

  async download(
    repo: RepositoryEntity,
    name: string,
    version?: string,
    _visited: Set<string> = new Set(),
    userId?: string,
  ) {
    const plugin = this.getPluginForRepo(repo);
    if (!plugin) {
      return { ok: false, message: 'No plugin found for repository' };
    }

    if (typeof plugin.download !== 'function') {
      return { ok: false, message: 'Plugin does not support download' };
    }

    return plugin.download(repo, name, version);
  }

  async listVersions(
    repo: RepositoryEntity,
    name: string,
    _visited: Set<string> = new Set(),
  ) {
    const plugin = this.getPluginForRepo(repo);
    if (!plugin) {
      return { ok: false, message: 'No plugin found for repository' };
    }

    if (typeof plugin.listVersions !== 'function') {
      return { ok: false, message: 'Plugin does not support listVersions' };
    }

    return plugin.listVersions(repo, name);
  }

  async proxyFetch(repo: RepositoryEntity, url: string) {
    const plugin = this.getPluginForRepo(repo);
    if (!plugin) {
      return { ok: false, message: 'No plugin found for repository' };
    }

    if (typeof plugin.proxyFetch !== 'function') {
      return { ok: false, message: 'Plugin does not support proxyFetch' };
    }

    return plugin.proxyFetch(repo, url);
  }

  async authenticate(
    repo: RepositoryEntity,
    credentials: any,
    _visited: Set<string> = new Set(),
  ) {
    const plugin = this.getPluginForRepo(repo);
    if (!plugin) {
      return { ok: false, message: 'No plugin found for repository' };
    }

    if (typeof plugin.authenticate !== 'function') {
      return { ok: false, message: 'Plugin does not support authentication' };
    }

    return plugin.authenticate(repo, credentials);
  }
}
