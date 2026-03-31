/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

  const toHelmRepoAlias = (repoName: string) => {
    const normalized = repoName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '');

    return normalized || 'repo';
  };

  const listVersions = async (repo: Repository, name: string) => {
    const versions = new Set<string>();

    const tryLoad = async (...keyParts: string[]) => {
      const indexKey = buildKey('helm', ...keyParts);
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

    await tryLoad(repo.id, 'index.yaml');
    await tryLoad(repo.name, 'index.yaml');

    if (repo.type === 'proxy') {
      await tryLoad(repo.id, 'proxy', 'file', 'index.yaml');
      await tryLoad(repo.name, 'proxy', 'file', 'index.yaml');
    }

    return { ok: true, versions: Array.from(versions) };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const repoUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
    const repoAlias = toHelmRepoAlias(repo.name);
    const name = pkg?.name || 'chart';
    const version = pkg?.version || '0.1.0';

    return [
      {
        label: 'helm install',
        language: 'bash',
        command: `helm repo add ${repoAlias} ${repoUrl}
      helm install my-release ${repoAlias}/${name} --version ${version}`,
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
