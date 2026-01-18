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

import { PluginContext, Repository } from '../utils/types';
import { buildKey } from '../utils/key-utils';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    // For raw, name is the filename.
    // We check if it exists.
    const versions = new Set<string>();

    const tryLoad = async (repoIdOrName: string) => {
      const key = buildKey('raw', repoIdOrName, name);
      try {
        const exists = await storage.exists(key);
        if (exists) {
          versions.add('latest');
        }
      } catch (e) {
        /* ignore */
      }
    };

    await tryLoad(repo.id);
    await tryLoad(repo.name);

    return { ok: true, versions: Array.from(versions) };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const url = `${proto}://${host}/repository/${repo.name}/${pkg.name}`;

    return [
      {
        label: 'curl',
        language: 'bash',
        command: `curl -O ${url}`,
      },
      {
        label: 'wget',
        language: 'bash',
        command: `wget ${url}`,
      },
      {
        label: 'PowerShell',
        language: 'powershell',
        command: `Invoke-WebRequest -Uri ${url} -OutFile ${pkg.name}`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
