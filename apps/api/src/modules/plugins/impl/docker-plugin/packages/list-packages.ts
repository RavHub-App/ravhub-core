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
import { type ListPackagesResult } from './helpers';
import {
  aggregateGroupPackages,
  collectRepositoryPackages,
} from './list-packages-support';

type ListPackagesDependencies = {
  storage: {
    list: (prefix: string) => Promise<string[]>;
    get: (key: string) => Promise<Buffer | null>;
  };
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
};

export function createListPackages({
  storage,
  getRepo,
}: ListPackagesDependencies) {
  const listPackages = async (
    repo: Repository,
  ): Promise<ListPackagesResult> => {
    try {
      const images = new Map();

      if ((repo?.type || '').toString().toLowerCase() === 'group') {
        return aggregateGroupPackages(repo, images, {
          getRepo,
          listPackages,
        });
      }

      return collectRepositoryPackages(repo, images, storage);
    } catch (error) {
      console.error('[DOCKER LIST PACKAGES ERROR]', error);
      return { ok: false, message: String(error) };
    }
  };

  return listPackages;
}
