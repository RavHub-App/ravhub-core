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

import { PluginContext, Repository } from '../utils/types';
import {
  buildComposerInstallMetadata,
  collectComposerPackageVersions,
} from './list-support';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = await collectComposerPackageVersions(storage, repo, name);
    return { ok: true, versions };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const { host, repoUrl, repositoryKey } = buildComposerInstallMetadata(repo);
    const name = pkg?.name || 'vendor/package';
    const version = pkg?.version || 'dev-master';

    return [
      {
        label: 'composer cli',
        language: 'bash',
        command: `composer config ${repositoryKey} composer ${repoUrl}
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
