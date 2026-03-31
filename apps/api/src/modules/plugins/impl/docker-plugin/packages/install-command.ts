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

import type { Repository } from '../utils/types';
import { getRegistryHost } from './helpers';

export async function getDockerInstallCommand(
  repo: Repository,
  pkg: { name: string; version: string },
) {
  const registry = getRegistryHost(repo);
  const image = `${registry}/${pkg.name}:${pkg.version}`;

  return [
    {
      label: 'docker pull',
      language: 'bash',
      command: `docker pull ${image}`,
    },
    {
      label: 'skopeo copy',
      language: 'bash',
      command: `skopeo copy docker://${image} docker://${pkg.name}:${pkg.version}`,
    },
    {
      label: 'Kubernetes (deployment)',
      language: 'yaml',
      command: `spec:
  containers:
  - name: ${pkg.name.split('/').pop()}
    image: ${image}`,
    },
  ];
}
