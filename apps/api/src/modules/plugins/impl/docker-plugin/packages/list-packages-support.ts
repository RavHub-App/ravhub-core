import type { Repository } from '../utils/types';
import { collectGroupMemberResults } from '../../../group-aggregation';
import {
  decodeTag,
  getStringTags,
  isDigestTag,
  type DockerImageEntry,
  type ListPackagesResult,
} from './helpers';

type StorageDependencies = {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Buffer | null>;
};

type GroupDependencies = {
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
  listPackages: (
    repo: Repository,
    visited: Set<string>,
  ) => Promise<ListPackagesResult>;
};

export async function aggregateGroupPackages(
  repo: Repository,
  images: Map<string, DockerImageEntry>,
  dependencies: GroupDependencies,
  visited = new Set<string>(),
): Promise<ListPackagesResult> {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES GROUP] repo=${repo.name || repo.id || 'unknown'} (id=${repo.id}), type=${repo.type}, members=${JSON.stringify(repo.config?.members || [])}`,
    );
  }

  if (!Array.isArray(repo.config?.members) || repo.config.members.length === 0) {
    console.warn(
      `[LIST PACKAGES GROUP] WARNING: Group ${repo.name || repo.id || 'unknown'} has no members configured`,
    );
    return { ok: true, packages: [] } satisfies ListPackagesResult;
  }

  const childResults = await collectGroupMemberResults({
    repo,
    getRepo: dependencies.getRepo,
    visited,
    resolveMember: async (childRepo, nextVisited) => {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug(
          `[LIST PACKAGES GROUP] Fetching from member ${childRepo.name} (id=${childRepo.id}, type=${childRepo.type})`,
        );
      }

      const childResult = await dependencies.listPackages(childRepo, nextVisited);
      const childPackageCount =
        childResult.ok && Array.isArray(childResult.packages)
          ? childResult.packages.length
          : 0;

      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug(
          `[LIST PACKAGES GROUP] Member ${childRepo.name} returned ${childPackageCount} packages`,
        );
      }

      return childResult.ok ? childResult.packages : null;
    },
    onMemberError: (memberId, memberRepo, error) => {
      console.warn(
        `[LIST PACKAGES GROUP] WARNING: Failed to fetch member ${memberRepo.name || memberRepo.id || memberId}`,
        error,
      );
    },
  });

  for (const childPackages of childResults) {
    mergeGroupPackages(images, childPackages);
  }

  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES GROUP] Returning ${images.size} aggregated packages`,
    );
  }

  return {
    ok: true,
    packages: Array.from(images.values()),
  } satisfies ListPackagesResult;
}

export async function collectRepositoryPackages(
  repo: Repository,
  images: Map<string, DockerImageEntry>,
  storage: StorageDependencies,
) {
  const prefix = `docker/${repo.id}/`;
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES ${repo.type?.toUpperCase()}] repo=${repo.name} (id=${repo.id}), prefix=${prefix}`,
    );
  }

  const legacyPrefix = `docker/${repo.name}/`;
  let legacyKeys: string[] = [];
  try {
    legacyKeys = await storage.list(legacyPrefix);
  } catch (error) {
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug(
        `[LIST PACKAGES ${repo.type?.toUpperCase()}] Legacy prefix lookup failed for ${legacyPrefix}`,
        error,
      );
    }
  }
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES ${repo.type?.toUpperCase()}] DEBUG: Found ${legacyKeys.length} keys with LEGACY prefix=${legacyPrefix}`,
    );
  }

  const keys = await storage.list(prefix);
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES ${repo.type?.toUpperCase()}] Found ${keys.length} keys with NEW prefix=${prefix}`,
    );
  }

  for (const key of keys) {
    if (!key.startsWith(prefix)) {
      continue;
    }

    const rel = key.slice(prefix.length);
    if (rel.startsWith('blobs/') || rel.startsWith('proxy/')) {
      continue;
    }

    const manifestCandidate = collectManifestPackage(images, rel);
    if (manifestCandidate) {
      continue;
    }

    await collectCachedTagPackage(images, key, rel, storage);
  }

  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[LIST PACKAGES ${repo.type?.toUpperCase()}] Returning ${images.size} packages`,
    );
  }

  return {
    ok: true,
    packages: Array.from(images.values()),
  } satisfies ListPackagesResult;
}

function mergeGroupPackages(
  images: Map<string, DockerImageEntry>,
  packages: DockerImageEntry[],
) {
  for (const pkg of packages) {
    if (!images.has(pkg.name)) {
      images.set(pkg.name, pkg);
      continue;
    }

    const existing = images.get(pkg.name);
    if (existing && new Date(pkg.updatedAt) > new Date(existing.updatedAt)) {
      images.set(pkg.name, pkg);
    }
  }
}

function collectManifestPackage(
  images: Map<string, DockerImageEntry>,
  rel: string,
) {
  const parts = rel.split('/');
  const manifestsIndex = parts.indexOf('manifests');
  if (!(manifestsIndex > 0 && manifestsIndex < parts.length - 1)) {
    return false;
  }

  const name = parts.slice(0, manifestsIndex).join('/');
  const tag = decodeTag(parts.slice(manifestsIndex + 1).join('/'));
  if (isDigestTag(tag)) {
    return true;
  }

  if (!images.has(name)) {
    images.set(name, {
      name,
      latestVersion: tag,
      updatedAt: new Date().toISOString(),
    });
  }
  if (tag === 'latest') {
    const existingImage = images.get(name);
    if (existingImage) {
      existingImage.latestVersion = 'latest';
    }
  }

  return true;
}

async function collectCachedTagPackage(
  images: Map<string, DockerImageEntry>,
  key: string,
  rel: string,
  storage: StorageDependencies,
) {
  const parts = rel.split('/');
  const tagsIndex = parts.indexOf('tags');
  if (!(tagsIndex > 0 && parts[tagsIndex + 1] === 'list')) {
    return;
  }

  const name = parts.slice(0, tagsIndex).join('/');
  const latestVersion = await resolveCachedLatestTag(storage, key);

  if (!images.has(name)) {
    images.set(name, {
      name,
      latestVersion,
      updatedAt: new Date().toISOString(),
    });
    return;
  }

  if (latestVersion === 'latest') {
    const existingImage = images.get(name);
    if (existingImage) {
      existingImage.latestVersion = 'latest';
    }
  }
}

async function resolveCachedLatestTag(
  storage: StorageDependencies,
  key: string,
) {
  try {
    const cached = await storage.get(key);
    if (!cached) {
      return undefined;
    }

    const tags = getStringTags(cached);
    if (tags.length === 0) {
      return undefined;
    }

    if (tags.includes('latest')) {
      return 'latest';
    }

    return tags[0];
  } catch {
    return undefined;
  }
}
