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
  PluginContext,
  Repository,
} from '../../../../../plugins-core/plugin.interface';
import { buildKey } from '../utils/key-utils';
import * as yaml from 'js-yaml';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = new Set<string>();

    const tryLoad = async (repoIdOrName: string) => {
      const indexKey = buildKey('helm', repoIdOrName, 'index.yaml');
      try {
        const content = await storage.get(indexKey);
        if (content) {
          const index: any = yaml.load(content.toString());
          if (index && index.entries && index.entries[name]) {
            index.entries[name].forEach((e: any) => {
              if (e.version) versions.add(e.version);
            });
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
    const repoUrl = `${proto}://${host}/repository/${repo.name}`;
    const name = pkg?.name || 'chart';
    const version = pkg?.version || '0.1.0';

    return [
      {
        label: 'helm install',
        language: 'bash',
        command: `helm repo add ${repo.name} ${repoUrl}
helm install my-release ${repo.name}/${name} --version ${version}`,
      },
      {
        label: 'helm dependency',
        language: 'yaml',
        command: `dependencies:
- name: ${name}
  version: ${version}
  repository: ${repoUrl}`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
