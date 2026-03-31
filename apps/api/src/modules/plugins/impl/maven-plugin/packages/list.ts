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
  collectMavenPackageVersions,
  parseMavenPackageCoordinates,
  resolveMavenInstallCoordinates,
} from './list-support';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const coordinates = parseMavenPackageCoordinates(name);
    if (!coordinates)
      return { ok: false, message: 'Invalid package name format' };
    const versions = await collectMavenPackageVersions(
      storage,
      repo,
      coordinates.artifactPath,
    );

    return { ok: true, versions };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const name = String(pkg?.name || '');
    const { groupId, artifactId } = resolveMavenInstallCoordinates(name);

    const version = pkg?.version || '1.0.0';

    return [
      {
        label: 'Maven (pom.xml)',
        language: 'xml',
        command: `<dependency>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>${version}</version>
</dependency>`,
      },
      {
        label: 'Maven (settings.xml)',
        language: 'xml',
        command: `<mirrors>
  <mirror>
    <id>${repo.name}</id>
    <mirrorOf>*</mirrorOf>
    <url>http://localhost:3000/repository/${repo.id}/</url>
  </mirror>
</mirrors>`,
      },
      {
        label: 'Gradle (Groovy)',
        language: 'groovy',
        command: `implementation '${groupId}:${artifactId}:${version}'`,
      },
      {
        label: 'Gradle (Kotlin)',
        language: 'kotlin',
        command: `implementation("${groupId}:${artifactId}:${version}")`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
