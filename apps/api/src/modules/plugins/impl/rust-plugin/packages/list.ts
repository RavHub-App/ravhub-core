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
      const prefix = buildKey('rust', repoIdOrName, name);
      try {
        const keys = await storage.list(prefix);
        for (const key of keys) {
          // rust/<repo>/<name>/<version>
          const parts = key.split('/');
          if (parts.length >= 4) {
            versions.add(decodeURIComponent(parts[3]));
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
    const indexUrl = `${proto}://${host}/repository/${repo.name}/index`;
    const name = pkg?.name || 'crate';
    const version = pkg?.version || '0.1.0';

    return [
      {
        label: 'Cargo.toml',
        language: 'toml',
        command: `${name} = { version = "${version}", registry = "${repo.name}" }`,
      },
      {
        label: 'cargo add',
        language: 'bash',
        command: `cargo add ${name}@${version} --registry ${repo.name}`,
      },
      {
        label: '.cargo/config.toml',
        language: 'toml',
        command: `[registries.${repo.name}]
index = "sparse+${indexUrl}"`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
