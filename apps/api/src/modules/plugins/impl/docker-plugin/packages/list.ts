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
import { getDockerPackageContext, initDockerPackageContext } from './context';
import { createGetPackage } from './get-package';
import { getDockerInstallCommand } from './install-command';
import { createListPackages } from './list-packages';
import { createListVersions } from './list-versions';

export function initPackages(context: {
  storage: {
    list: (prefix: string) => Promise<string[]>;
    get: (key: string) => Promise<Buffer | null>;
  };
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
  proxyFetch?: (
    repo: Repository,
    path: string,
  ) => Promise<{ ok?: boolean; body?: unknown } | undefined>;
}) {
  initDockerPackageContext(context);
}

export async function listPackages(repo: Repository) {
  const context = getDockerPackageContext();
  if (!context.storage) {
    throw new Error('Docker package context storage not initialized');
  }

  return createListPackages({
    storage: context.storage,
    getRepo: context.getRepo,
  })(repo);
}

export async function getPackage(repo: Repository, name: string) {
  const context = getDockerPackageContext();
  if (!context.storage) {
    throw new Error('Docker package context storage not initialized');
  }

  return createGetPackage({
    storage: context.storage,
    getRepo: context.getRepo,
  })(repo, name);
}

export async function listVersions(repo: Repository, name: string) {
  const context = getDockerPackageContext();
  if (!context.storage) {
    throw new Error('Docker package context storage not initialized');
  }

  return createListVersions({
    storage: context.storage,
    proxyFetch: context.proxyFetch,
    getRepo: context.getRepo,
  })(repo, name);
}

export async function getInstallCommand(
  repo: Repository,
  pkg: { name: string; version: string },
) {
  return getDockerInstallCommand(repo, pkg);
}
