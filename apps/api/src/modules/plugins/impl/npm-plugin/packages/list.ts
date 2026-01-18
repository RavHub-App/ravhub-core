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
    const metaPath = `${name}/package.json`;

    const tryLoad = async (repoIdOrName: string) => {
      const key = buildKey('npm', repoIdOrName, metaPath);
      try {
        const data = await storage.get(key);
        if (data) {
          const json = JSON.parse(data.toString());
          if (json.versions) {
            Object.keys(json.versions).forEach((v) => versions.add(v));
          }
        }
      } catch (e) {
        /* ignore */
      }
    };

    await tryLoad(repo.id);
    await tryLoad(repo.name);

    return {
      ok: true,
      versions: Array.from(versions),
    };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const registryUrl = `${proto}://${host}/repository/${repo.name}`;
    const name = pkg?.name || 'package';
    const version = pkg?.version || 'latest';

    return [
      {
        label: 'npm',
        language: 'bash',
        command: `npm install ${name}@${version} --registry=${registryUrl}`,
      },
      {
        label: 'yarn',
        language: 'bash',
        command: `yarn add ${name}@${version} --registry ${registryUrl}`,
      },
      {
        label: 'pnpm',
        language: 'bash',
        command: `pnpm add ${name}@${version} --registry ${registryUrl}`,
      },
      {
        label: '.npmrc',
        language: 'ini',
        command: `registry=${registryUrl}
always-auth=true`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
