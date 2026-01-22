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

import type { Repository } from '../utils/types';

// Plugin context references (will be set by init)
let storage: any = null;
let getRepo: any = null;

/**
 * Initialize the packages module with plugin context
 */
export function initPackages(context: { storage: any; getRepo?: any }) {
  storage = context.storage;
  getRepo = context.getRepo;
}

/**
 * List all packages (images) in a repository
 * For groups, aggregates packages from all members
 */
export async function listPackages(repo: Repository) {
  try {
    const images = new Map<string, any>();

    // GROUP: iterate members and aggregate packages
    if ((repo?.type || '').toString().toLowerCase() === 'group') {
      const members: string[] = Array.isArray(repo.config?.members)
        ? repo.config.members
        : [];
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug(
          `[LIST PACKAGES GROUP] repo=${repo.name || repo.id || 'unknown'} (id=${repo.id}), type=${repo.type}, members=${JSON.stringify(members)}`,
        );

      if (members.length === 0) {
        console.warn(
          `[LIST PACKAGES GROUP] WARNING: Group ${repo.name || repo.id || 'unknown'} has no members configured`,
        );
        return { ok: true, packages: [] };
      }

      for (const mid of members) {
        const childRepo = await getRepo?.(mid);
        if (!childRepo) {
          console.warn(
            `[LIST PACKAGES GROUP] WARNING: Member ${mid} not found`,
          );
          continue;
        }
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
          console.debug(
            `[LIST PACKAGES GROUP] Fetching from member ${childRepo.name} (id=${childRepo.id}, type=${childRepo.type})`,
          );
        const childResult = await listPackages(childRepo);
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
          console.debug(
            `[LIST PACKAGES GROUP] Member ${childRepo.name} returned ${childResult?.packages?.length || 0} packages`,
          );
        if (childResult?.ok && Array.isArray(childResult.packages)) {
          for (const pkg of childResult.packages) {
            // Use image name as key to deduplicate across members
            if (!images.has(pkg.name)) {
              images.set(pkg.name, pkg);
            } else {
              // If image exists, keep the most recent version
              const existing = images.get(pkg.name);
              if (new Date(pkg.updatedAt) > new Date(existing.updatedAt || 0)) {
                images.set(pkg.name, pkg);
              }
            }
          }
        }
      }

      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug(
          `[LIST PACKAGES GROUP] Returning ${images.size} aggregated packages`,
        );
      return { ok: true, packages: Array.from(images.values()) };
    }

    // HOSTED/PROXY: list packages from local storage
    const prefix = `docker/${repo.id}/`;
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug(
        `[LIST PACKAGES ${repo.type?.toUpperCase()}] repo=${repo.name} (id=${repo.id}), prefix=${prefix}`,
      );

    // DEBUG: Also try with repo.name to see if data exists there
    const legacyPrefix = `docker/${repo.name}/`;
    const legacyKeys = await storage.list(legacyPrefix);
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug(
        `[LIST PACKAGES ${repo.type?.toUpperCase()}] DEBUG: Found ${legacyKeys.length} keys with LEGACY prefix=${legacyPrefix}`,
      );

    const keys = await storage.list(prefix);
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug(
        `[LIST PACKAGES ${repo.type?.toUpperCase()}] Found ${keys.length} keys with NEW prefix=${prefix}`,
      );

    for (const key of keys) {
      // key format: docker/<repo>/<image>/manifests/<tag>
      if (!key.startsWith(prefix)) continue;
      const rel = key.slice(prefix.length);
      if (rel.startsWith('blobs/') || rel.startsWith('proxy/')) continue;

      const parts = rel.split('/');
      const maniIdx = parts.indexOf('manifests');
      if (maniIdx > 0 && maniIdx < parts.length - 1) {
        const name = parts.slice(0, maniIdx).join('/');
        const tag = parts.slice(maniIdx + 1).join('/');

        // Filter out digest-based keys (internal storage for pull-by-digest)
        if (
          tag.startsWith('sha256:') ||
          tag.startsWith('sha384:') ||
          tag.startsWith('sha512:')
        )
          continue;

        if (!images.has(name)) {
          images.set(name, {
            name,
            latestVersion: tag,
            updatedAt: new Date().toISOString(),
          });
        }
        if (tag === 'latest') {
          images.get(name).latestVersion = 'latest';
        }
      }
    }

    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug(
        `[LIST PACKAGES ${repo.type?.toUpperCase()}] Returning ${images.size} packages`,
      );
    return { ok: true, packages: Array.from(images.values()) };
  } catch (e: any) {
    console.error('[DOCKER LIST PACKAGES ERROR]', e);
    return { ok: false, message: String(e) };
  }
}

/**
 * Get metadata for a specific package (all tags/versions of an image)
 */
export async function getPackage(repo: Repository, name: string) {
  try {
    const artifactsMap = new Map<string, any>();

    // GROUP: iterate members and aggregate artifacts (tags) for the image
    if ((repo?.type || '').toString().toLowerCase() === 'group') {
      const members: string[] = Array.isArray(repo.config?.members)
        ? repo.config.members
        : [];
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug(
          `[GET PACKAGE GROUP] repo=${repo.name}, image=${name}, members=${members.length}`,
        );

      // Use group's accessUrl for install command
      let registry = repo.accessUrl || 'localhost:5000';
      registry = registry.replace(/^https?:\/\//, '');

      for (const mid of members) {
        const childRepo = await getRepo?.(mid);
        if (!childRepo) continue;
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
          console.debug(
            `[GET PACKAGE GROUP] fetching from member ${childRepo.name}`,
          );
        const childResult = await getPackage(childRepo, name);
        if (childResult?.ok && Array.isArray(childResult.artifacts)) {
          for (const artifact of childResult.artifacts) {
            // Use tag as key to deduplicate across members
            const tag = artifact.version || artifact.id;
            if (!artifactsMap.has(tag)) {
              // Update install command to use group's registry
              artifactsMap.set(tag, {
                ...artifact,
                installCommand: `docker pull ${registry}/${name}:${tag}`,
              });
            } else {
              // If tag exists, keep the most recent one
              const existing = artifactsMap.get(tag);
              if (
                new Date(artifact.createdAt) > new Date(existing.createdAt || 0)
              ) {
                artifactsMap.set(tag, {
                  ...artifact,
                  installCommand: `docker pull ${registry}/${name}:${tag}`,
                });
              }
            }
          }
        }
      }

      return { ok: true, name, artifacts: Array.from(artifactsMap.values()) };
    }

    // HOSTED/PROXY: get package from local storage
    const prefix = `docker/${repo.id}/${name}/manifests/`;
    const keys = await storage.list(prefix);
    const artifacts: any[] = [];

    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      let tag = key.slice(prefix.length);

      // Decode URL-encoded characters (e.g., %3A -> :)
      try {
        tag = decodeURIComponent(tag);
      } catch (e) {
        // If decode fails, use original
      }

      // Skip if tag contains slash (shouldn't happen for valid tags, but safety)
      if (tag.includes('/')) continue;
      // Filter out digest-based keys
      if (
        tag.startsWith('sha256:') ||
        tag.startsWith('sha384:') ||
        tag.startsWith('sha512:')
      )
        continue;

      // Construct install command
      // Use repo.accessUrl if available, else localhost default
      let registry = repo.accessUrl || 'localhost:5000';
      registry = registry.replace(/^https?:\/\//, '');

      // Try to read manifest to get size and created date
      let size = 0;
      const createdAt = new Date().toISOString();

      try {
        const content = await storage.get(key);
        if (content) {
          const json = JSON.parse(content.toString('utf8'));

          // Calculate size
          if (Array.isArray(json.manifests)) {
            // Manifest list
            size = json.manifests.reduce(
              (acc: number, m: any) => acc + (m.size || 0),
              0,
            );
          } else if (Array.isArray(json.layers)) {
            // Regular manifest
            size = json.layers.reduce(
              (acc: number, l: any) => acc + (l.size || 0),
              0,
            );
          }

          if (json.config && json.config.size) {
            size += json.config.size;
          }
        }
      } catch (e) {
        // ignore manifest read errors
      }

      artifacts.push({
        id: tag,
        version: tag,
        type: 'docker/image',
        name: name,
        createdAt,
        installCommand: `docker pull ${registry}/${name}:${tag}`,
        size,
      });
    }

    return { ok: true, name, artifacts };
  } catch (e: any) {
    return { ok: false, message: String(e) };
  }
}

import { buildKey } from '../utils/key-utils';

/**
 * List supported registry versions (tags)
 */
export async function listVersions(repo: Repository, name: string) {
  try {
    const versions = new Set<string>();

    // GROUP: iterate members and aggregate versions
    if ((repo?.type || '').toString().toLowerCase() === 'group') {
      const members: string[] = Array.isArray(repo.config?.members)
        ? repo.config.members
        : [];
      for (const mid of members) {
        const childRepo = await getRepo?.(mid);
        if (!childRepo) continue;
        const childResult = await listVersions(childRepo, name);
        if (childResult?.ok && Array.isArray(childResult.versions)) {
          childResult.versions.forEach((v: string) => versions.add(v));
        }
      }
      return { ok: true, versions: Array.from(versions) };
    }

    // HOSTED/PROXY: list tags from local storage
    const tryLoad = async (repoIdOrName: string) => {
      // docker/<repo>/<image>/manifests/
      const prefix = buildKey('docker', repoIdOrName, name, 'manifests') + '/';
      try {
        const keys = await storage.list(prefix);
        for (const key of keys) {
          if (!key.startsWith(prefix)) continue;
          let tag = key.slice(prefix.length);
          try {
            tag = decodeURIComponent(tag);
          } catch (e) { }

          if (tag.includes('/')) continue;
          if (
            tag.startsWith('sha256:') ||
            tag.startsWith('sha384:') ||
            tag.startsWith('sha512:')
          )
            continue;

          versions.add(tag);
        }
      } catch (e) {
        /* ignore */
      }
    };

    await tryLoad(repo.id);
    await tryLoad(repo.name);

    return { ok: true, versions: Array.from(versions) };
  } catch (err) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Generate install instructions for a package
 */
export async function getInstallCommand(repo: Repository, pkg: any) {
  // repo.accessUrl should be present (e.g. http://localhost:5000)
  // docker pull expects host:port/image:tag
  let registry = repo.accessUrl || 'localhost:5000';
  registry = registry.replace(/^https?:\/\//, '');
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
