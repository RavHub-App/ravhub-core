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

type ProxyFetchResult = {
  ok?: boolean;
  body?: unknown;
};

type PackageStorage = {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Buffer | null>;
};

type GetRepo = (id: string) => Promise<Repository | null | undefined>;
type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResult | undefined>;

type PackageContext = {
  storage: PackageStorage | null;
  getRepo?: GetRepo;
  proxyFetch?: ProxyFetch;
};

const packageContext: PackageContext = {
  storage: null,
};

export function initDockerPackageContext(context: {
  storage: PackageStorage;
  getRepo?: GetRepo;
  proxyFetch?: ProxyFetch;
}) {
  packageContext.storage = context.storage;
  packageContext.getRepo = context.getRepo;
  packageContext.proxyFetch = context.proxyFetch;
}

export function getDockerPackageContext() {
  return packageContext;
}
