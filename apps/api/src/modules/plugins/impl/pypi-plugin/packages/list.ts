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
  buildPypiInstallMetadata,
  collectPypiPackageVersions,
} from './list-support';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = await collectPypiPackageVersions(storage, repo, name);
    return { ok: true, versions };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const name = pkg?.name || 'package';
    const version = pkg?.version || '0.0.1';
    const { host, indexUrl, sourceName } = buildPypiInstallMetadata(repo);

    return [
      {
        label: 'pip',
        language: 'bash',
        command: `pip install ${name}==${version} --index-url ${indexUrl}`,
      },
      {
        label: 'poetry',
        language: 'bash',
        command: `poetry add ${name}==${version} --source "${sourceName}"`,
      },
      {
        label: 'pip.conf',
        language: 'ini',
        command: `[global]
index-url = ${indexUrl}
trusted-host = ${host.split(':')[0]}`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
