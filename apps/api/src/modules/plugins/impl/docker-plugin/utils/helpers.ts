/*
 * Copyright (C) 2026 RavHub Team
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
export function normalizeImageName(
  imageName: string,
  proxyUrl: string,
  repo?: any,
): string {
  const cfg = repo?.config?.docker ?? repo?.config ?? {};
  // Legacy or advanced setting: libraryPrefix (string) kept for compatibility
  if (typeof cfg?.libraryPrefix === 'string') {
    const behavior = cfg.libraryPrefix || 'auto';
    if (behavior === 'disabled') return imageName;
    const hasNamespace = imageName.includes('/');
    const isDockerHub =
      String(proxyUrl).includes('registry-1.docker.io') ||
      String(proxyUrl).includes('docker.io');
    if (behavior === 'enabled')
      return hasNamespace ? imageName : `library/${imageName}`;
    // auto
    return isDockerHub && !hasNamespace ? `library/${imageName}` : imageName;
  }

  // New simple boolean: isDockerHub (checkbox). If explicitly set, obey it.
  if (typeof cfg?.isDockerHub === 'boolean') {
    const hasNamespace = imageName.includes('/');
    return cfg.isDockerHub && !hasNamespace
      ? `library/${imageName}`
      : imageName;
  }

  // Fallback (no config): auto-detect by upstream host
  const isDockerHub =
    String(proxyUrl).includes('registry-1.docker.io') ||
    String(proxyUrl).includes('docker.io');
  const hasNamespace = imageName.includes('/');
  return isDockerHub && !hasNamespace ? `library/${imageName}` : imageName;
}

/**
 * Shared state for uploads across the plugin
 */
export const uploads: Map<string, Buffer> = new Map();

/**
 * Shared state for upload targets (group repository routing)
 */
export const uploadTargets: Map<
  string,
  {
    groupId: string;
    targets: { repoId: string; uuid: string }[];
    policy: string;
  }
> = new Map();
