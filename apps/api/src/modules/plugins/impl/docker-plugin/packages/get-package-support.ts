import type { Repository } from '../utils/types';
import { collectGroupMemberResults } from '../../../group-aggregation';
import {
  decodeTag,
  getManifestSize,
  getRegistryHost,
  getStringTags,
  isDigestTag,
  type DockerArtifactEntry,
  type GetPackageResult,
} from './helpers';

type StorageDependencies = {
  list: (prefix: string) => Promise<string[]>;
  get: (key: string) => Promise<Buffer | null>;
};

type GroupDependencies = {
  getRepo?: (id: string) => Promise<Repository | null | undefined>;
  getPackage: (
    repo: Repository,
    name: string,
    visited: Set<string>,
  ) => Promise<GetPackageResult>;
};

export async function aggregateDockerGroupArtifacts(
  repo: Repository,
  name: string,
  artifactsMap: Map<string, DockerArtifactEntry>,
  dependencies: GroupDependencies,
  visited = new Set<string>(),
): Promise<GetPackageResult> {
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug(
      `[GET PACKAGE GROUP] repo=${repo.name}, image=${name}, members=${Array.isArray(repo.config?.members) ? repo.config.members.length : 0}`,
    );
  }

  const registry = getRegistryHost(repo);

  const childResults = await collectGroupMemberResults({
    repo,
    getRepo: dependencies.getRepo,
    visited,
    resolveMember: async (childRepo, nextVisited) => {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug(
          `[GET PACKAGE GROUP] fetching from member ${childRepo.name}`,
        );
      }

      const childResult = await dependencies.getPackage(
        childRepo,
        name,
        nextVisited,
      );
      return childResult.ok ? childResult.artifacts : null;
    },
    onMemberError: (memberId, memberRepo, error) => {
      console.warn(
        `[GET PACKAGE GROUP] WARNING: Failed to fetch member ${memberRepo.name || memberRepo.id || memberId}`,
        error,
      );
    },
  });

  for (const childArtifacts of childResults) {
    mergeDockerArtifacts(artifactsMap, childArtifacts, registry, name);
  }

  return { ok: true, name, artifacts: Array.from(artifactsMap.values()) };
}

export async function collectDockerPackageArtifacts(
  storage: StorageDependencies,
  repo: Repository,
  name: string,
  artifactsMap: Map<string, DockerArtifactEntry>,
) {
  const registry = getRegistryHost(repo);
  const repoKeys = [repo.id, repo.name].filter(
    (value, index, values): value is string =>
      !!value && values.indexOf(value) === index,
  );

  for (const repoKey of repoKeys) {
    await loadDockerManifestArtifacts(
      storage,
      repoKey,
      name,
      registry,
      artifactsMap,
    );
  }

  if (artifactsMap.size !== 0) {
    return;
  }

  for (const repoKey of repoKeys) {
    const cachedTags = await loadDockerCachedTags(storage, repoKey, name);
    for (const tag of cachedTags) {
      addDockerArtifact(artifactsMap, repo, name, tag, 0);
    }
  }
}

function mergeDockerArtifacts(
  artifactsMap: Map<string, DockerArtifactEntry>,
  artifacts: DockerArtifactEntry[],
  registry: string,
  name: string,
) {
  for (const artifact of artifacts) {
    const tag = artifact.version || artifact.id;
    if (!artifactsMap.has(tag)) {
      artifactsMap.set(tag, {
        ...artifact,
        installCommand: `docker pull ${registry}/${name}:${tag}`,
      });
      continue;
    }

    const existing = artifactsMap.get(tag);
    if (
      existing &&
      new Date(artifact.createdAt) > new Date(existing.createdAt)
    ) {
      artifactsMap.set(tag, {
        ...artifact,
        installCommand: `docker pull ${registry}/${name}:${tag}`,
      });
    }
  }
}

async function loadDockerManifestArtifacts(
  storage: StorageDependencies,
  repoKey: string,
  name: string,
  registry: string,
  artifactsMap: Map<string, DockerArtifactEntry>,
) {
  const prefix = `docker/${repoKey}/${name}/manifests/`;
  let keys: string[] = [];
  try {
    keys = await storage.list(prefix);
  } catch {
    return;
  }

  for (const key of keys) {
    if (!key.startsWith(prefix)) continue;
    const tag = decodeTag(key.slice(prefix.length));
    if (tag.includes('/') || isDigestTag(tag)) {
      continue;
    }

    let size = 0;
    try {
      const content = await storage.get(key);
      if (content) {
        size = getManifestSize(content);
      }
    } catch {
      size = 0;
    }

    addDockerArtifact(
      artifactsMap,
      { accessUrl: `http://${registry}` } as Repository,
      name,
      tag,
      size,
      registry,
    );
  }
}

async function loadDockerCachedTags(
  storage: StorageDependencies,
  repoId: string,
  imageName: string,
) {
  const key = `docker/${repoId}/${imageName}/tags/list`;
  try {
    const cached = await storage.get(key);
    if (!cached) {
      return [] as string[];
    }

    return getStringTags(cached).filter((tag: string): tag is string => {
      return typeof tag === 'string' && !tag.includes('/') && !isDigestTag(tag);
    });
  } catch {
    return [] as string[];
  }
}

function addDockerArtifact(
  artifactsMap: Map<string, DockerArtifactEntry>,
  repo: Repository,
  name: string,
  tag: string,
  size: number,
  registry = getRegistryHost(repo),
) {
  if (artifactsMap.has(tag)) {
    return;
  }

  artifactsMap.set(tag, {
    id: tag,
    version: tag,
    type: 'docker/image',
    name,
    createdAt: new Date().toISOString(),
    installCommand: `docker pull ${registry}/${name}:${tag}`,
    size,
  });
}
