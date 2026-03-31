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

import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type StorageList = {
  list: (prefix: string) => Promise<string[]>;
};

type PackagesResponse = {
  ok: true;
  data: string;
  contentType: 'application/json';
};

function createEmptyPackagesResponse(): PackagesResponse {
  return {
    ok: true,
    data: JSON.stringify({ packages: {} }),
    contentType: 'application/json',
  };
}

export async function buildHostedPackagesJson(
  repo: Repository,
  storage: StorageList,
): Promise<PackagesResponse> {
  const prefix = buildKey('composer', repo.id);
  try {
    const keys = await storage.list(prefix);
    const packages: Record<string, Record<string, unknown>> = {};
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const baseUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;

    for (const key of keys) {
      const parts = key.split('/');
      if (parts.length < 5) {
        continue;
      }
      const versionSegment = decodeURIComponent(parts.pop()!);
      const packageName = parts
        .slice(2)
        .map((segment) => decodeURIComponent(segment))
        .join('/');
      const cleanVersion = versionSegment.endsWith('.zip')
        ? versionSegment.slice(0, -4)
        : versionSegment;
      if (!packages[packageName]) {
        packages[packageName] = {};
      }
      packages[packageName][cleanVersion] = {
        name: packageName,
        version: cleanVersion,
        dist: {
          url: `${baseUrl}/${packageName}/${versionSegment}`,
          type: 'zip',
        },
      };
    }

    return {
      ok: true,
      data: JSON.stringify({ packages }),
      contentType: 'application/json',
    };
  } catch (error) {
    console.warn(
      `[Composer] Failed to generate packages.json for ${repo.name}: ${String(error)}`,
    );
    return createEmptyPackagesResponse();
  }
}
