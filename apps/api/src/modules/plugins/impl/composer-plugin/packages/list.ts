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
    const nameParts = name.split('/').filter(Boolean);
    // Expected structure: composer/<repo>/<name_part_1>/.../<name_part_N>/<version>
    // Index of version = 1 (composer) + 1 (repo) + nameParts.length
    // Wait, split gives 0-based index.
    // 0: composer
    // 1: repo
    // 2: name_part_1
    // ...
    // 1 + nameParts.length: name_part_N
    // 2 + nameParts.length: version
    const versionIndex = 2 + nameParts.length;

    // Check ID-based keys
    const prefixId = buildKey('composer', repo.id, name);
    try {
      const keys = await storage.list(prefixId);
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length > versionIndex) {
          versions.add(parts[versionIndex]);
        }
      }
    } catch (e) {
      /* ignore */
    }

    // Check ID-based keys (Proxy)
    const prefixProxyId = buildKey('composer', repo.id, 'proxy', name);
    try {
      const keys = await storage.list(prefixProxyId);
      for (const key of keys) {
        const parts = key.split('/');
        // Proxy adds one segment ('proxy'), so version index is +1
        if (parts.length > versionIndex + 1) {
          versions.add(parts[versionIndex + 1]);
        }
      }
    } catch (e) {
      /* ignore */
    }

    // Check Name-based keys (fallback)
    const prefixName = buildKey('composer', repo.name, name);
    try {
      const keys = await storage.list(prefixName);
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length > versionIndex) {
          versions.add(parts[versionIndex]);
        }
      }
    } catch (e) {
      /* ignore */
    }

    // Check Name-based keys (Proxy fallback)
    const prefixProxyName = buildKey('composer', repo.name, 'proxy', name);
    try {
      const keys = await storage.list(prefixProxyName);
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length > versionIndex + 1) {
          versions.add(parts[versionIndex + 1]);
        }
      }
    } catch (e) {
      /* ignore */
    }

    return {
      ok: true,
      versions: Array.from(versions),
    };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const repoUrl = `${proto}://${host}/repository/${repo.name}`;
    const name = pkg?.name || 'vendor/package';
    const version = pkg?.version || 'dev-master';

    return [
      {
        label: 'composer cli',
        language: 'bash',
        command: `composer config repositories.${repo.name} composer ${repoUrl}
composer require ${name}:${version}`,
      },
      {
        label: 'composer.json',
        language: 'json',
        command: `{
  "repositories": [
    {
      "type": "composer",
      "url": "${repoUrl}"
    }
  ],
  "require": {
    "${name}": "${version}"
  }
}`,
      },
      {
        label: 'auth.json',
        language: 'json',
        command: `{
  "http-basic": {
    "${host.split(':')[0]}": {
      "username": "YOUR_USERNAME",
      "password": "YOUR_PASSWORD"
    }
  }
}`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
