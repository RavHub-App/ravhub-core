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
    const versions = new Set<string>();

    const tryLoad = async (repoIdOrName: string) => {
      const prefix = buildKey('nuget', repoIdOrName, name);
      try {
        const keys = await storage.list(prefix);
        for (const key of keys) {
          // nuget/<repo>/<name>/<version>/...
          const parts = key.split('/');
          if (parts.length >= 4) {
            versions.add(parts[3]);
          }
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
    const sourceUrl = `${proto}://${host}/repository/${repo.name}/index.json`;
    const name = pkg?.name || 'Package';
    const version = pkg?.version || '1.0.0';

    return [
      {
        label: 'dotnet cli',
        language: 'bash',
        command: `dotnet add package ${name} --version ${version} --source ${sourceUrl}`,
      },
      {
        label: 'NuGet CLI',
        language: 'bash',
        command: `nuget install ${name} -Version ${version} -Source ${sourceUrl}`,
      },
      {
        label: 'Package Manager',
        language: 'powershell',
        command: `Install-Package ${name} -Version ${version} -Source ${sourceUrl}`,
      },
      {
        label: 'NuGet.config',
        language: 'xml',
        command: `<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <packageSources>
    <add key="${repo.name}" value="${sourceUrl}" />
  </packageSources>
</configuration>`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
