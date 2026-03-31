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
  buildRustInstallMetadata,
  collectRustPackageVersions,
} from './list-support';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = await collectRustPackageVersions(storage, repo, name);
    return { ok: true, versions };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const name = pkg?.name || 'crate';
    const version = pkg?.version || '0.1.0';
    const { indexUrl, registryName } = buildRustInstallMetadata(repo);

    return [
      {
        label: 'Cargo.toml',
        language: 'toml',
        command: `${name} = { version = "${version}", registry = "${registryName}" }`,
      },
      {
        label: 'cargo add',
        language: 'bash',
        command: `cargo add ${name}@${version} --registry "${registryName}"`,
      },
      {
        label: '.cargo/config.toml',
        language: 'toml',
        command: `[registries."${registryName}"]
index = "sparse+${indexUrl}"`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
