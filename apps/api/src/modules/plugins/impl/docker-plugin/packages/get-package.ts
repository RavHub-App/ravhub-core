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
import { type DockerArtifactEntry, type GetPackageResult } from './helpers';
import {
  aggregateDockerGroupArtifacts,
  collectDockerPackageArtifacts,
} from './get-package-support';

type GetPackageDependencies = {
  storage: {
    list: (prefix: string) => Promise<string[]>;
    get: (key: string) => Promise<Buffer | null>;
  };
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
};

export function createGetPackage({ storage, getRepo }: GetPackageDependencies) {
  const getPackage = async (
    repo: Repository,
    name: string,
  ): Promise<GetPackageResult> => {
    try {
      const artifactsMap = new Map<string, DockerArtifactEntry>();

      if ((repo?.type || '').toString().toLowerCase() === 'group') {
        return aggregateDockerGroupArtifacts(repo, name, artifactsMap, {
          getRepo,
          getPackage,
        });
      }

      await collectDockerPackageArtifacts(storage, repo, name, artifactsMap);

      return { ok: true, name, artifacts: Array.from(artifactsMap.values()) };
    } catch (error) {
      return { ok: false, message: String(error) };
    }
  };

  return getPackage;
}
