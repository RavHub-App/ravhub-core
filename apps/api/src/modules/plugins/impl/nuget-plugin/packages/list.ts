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
  buildNugetInstallSource,
  collectNugetPackageVersions,
  escapeNugetXmlAttribute,
} from './list-support';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = await collectNugetPackageVersions(storage, repo, name);
    return { ok: true, versions };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const sourceUrl = buildNugetInstallSource(repo);
    const sourceName = escapeNugetXmlAttribute(repo.name);
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
    <add key="${sourceName}" value="${sourceUrl}" />
  </packageSources>
</configuration>`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
