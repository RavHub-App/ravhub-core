import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';
import { collectGroupMemberResults } from '../../../group-aggregation';
import {
  decodeTag,
  getStringTags,
  isDigestTag,
  isRecord,
  parseDockerStoredPayload,
  type ListVersionsResult,
  type ProxyFetchResult,
} from './helpers';

type StorageDependencies = {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Buffer | null>;
};

type GroupDependencies = {
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
  listVersions: (
    repo: Repository,
    name: string,
    visited: Set<string>,
  ) => Promise<ListVersionsResult>;
};

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResult | undefined>;

export async function aggregateDockerGroupVersions(
  repo: Repository,
  name: string,
  versions: Set<string>,
  dependencies: GroupDependencies,
  visited = new Set<string>(),
): Promise<ListVersionsResult> {
  const childResults = await collectGroupMemberResults({
    repo,
    getRepo: dependencies.getRepo,
    visited,
    resolveMember: async (childRepo, nextVisited) => {
      const childResult = await dependencies.listVersions(
        childRepo,
        name,
        nextVisited,
      );
      return childResult.ok ? childResult.versions : null;
    },
    onMemberError: (memberId, memberRepo, error) => {
      console.warn(
        `[LIST VERSIONS GROUP] WARNING: Failed to fetch member ${memberRepo.name || memberRepo.id || memberId}`,
        error,
      );
    },
  });

  for (const childVersions of childResults) {
    childVersions.forEach((version) => versions.add(version));
  }

  return { ok: true, versions: Array.from(versions) };
}

export async function collectDockerManifestVersions(
  storage: StorageDependencies,
  repo: Repository,
  name: string,
  versions: Set<string>,
) {
  const repoKeys = [repo.id, repo.name].filter(
    (value, index, values): value is string =>
      !!value && values.indexOf(value) === index,
  );

  for (const repoKey of repoKeys) {
    await loadDockerManifestVersions(storage, repoKey, name, versions);
  }

  for (const repoKey of repoKeys) {
    await loadDockerCachedTagVersions(storage, repoKey, name, versions);
  }
}

export async function fetchDockerProxyVersionsFromUpstream(
  proxyFetch: ProxyFetch,
  repo: Repository,
  name: string,
  versions: Set<string>,
) {
  const target =
    repo?.config?.proxyUrl ||
    repo?.config?.docker?.proxyUrl ||
    repo?.config?.upstream ||
    repo?.config?.docker?.upstream ||
    repo?.config?.target ||
    repo?.config?.registry ||
    null;

  if (!target) {
    return;
  }

  const encodedName = String(name)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const targetBase = String(target).replace(/\/$/, '');
  const needsV2 = !/\/v2(\/|$)/.test(targetBase);
  const upstreamUrl = `${targetBase}${needsV2 ? '/v2' : ''}/${encodedName}/tags/list`;
  const upstreamResult = await proxyFetch(repo, upstreamUrl);

  if (upstreamResult?.ok && upstreamResult.body) {
    getStringTags(upstreamResult.body).forEach((tag) => versions.add(tag));
  }
}

async function loadDockerManifestVersions(
  storage: StorageDependencies,
  repoIdOrName: string,
  name: string,
  versions: Set<string>,
) {
  const prefix = buildKey('docker', repoIdOrName, name, 'manifests') + '/';
  try {
    const keys = await storage.list(prefix);
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const tag = decodeTag(key.slice(prefix.length));
      if (tag.includes('/') || isDigestTag(tag)) {
        continue;
      }
      versions.add(tag);
    }
  } catch (error) {
    console.warn(
      `[LIST VERSIONS] Failed to list manifests under ${prefix}: ${String(error)}`,
    );
  }
}

async function loadDockerCachedTagVersions(
  storage: StorageDependencies,
  repoIdOrName: string,
  name: string,
  versions: Set<string>,
) {
  const key = buildKey('docker', repoIdOrName, name, 'tags', 'list');
  try {
    const cached = await storage.get(key);
    if (!cached) {
      return;
    }

    const parsedPayload = parseDockerStoredPayload(cached);
    if (!isRecord(parsedPayload) || !Array.isArray(parsedPayload.tags)) {
      return;
    }

    parsedPayload.tags
      .filter((tag: unknown): tag is string => typeof tag === 'string')
      .forEach((tag) => versions.add(tag));
  } catch (error) {
    console.warn(
      `[LIST VERSIONS] Failed to read cached tags from ${key}: ${String(error)}`,
    );
  }
}
