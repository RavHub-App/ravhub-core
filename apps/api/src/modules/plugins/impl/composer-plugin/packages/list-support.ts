import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type VersionListStorage = {
  list: (prefix: string) => Promise<string[]>;
};

export async function collectComposerPackageVersions(
  storage: VersionListStorage,
  repo: Repository,
  name: string,
) {
  const versions = new Set<string>();
  const nameParts = name.split('/').filter(Boolean);
  const versionIndex = 2 + nameParts.length;

  await loadComposerVersions(
    storage,
    versions,
    versionIndex,
    false,
    repo.id,
    name,
  );
  await loadComposerVersions(
    storage,
    versions,
    versionIndex,
    true,
    repo.id,
    name,
  );
  await loadComposerVersions(
    storage,
    versions,
    versionIndex,
    false,
    repo.name,
    name,
  );
  await loadComposerVersions(
    storage,
    versions,
    versionIndex,
    true,
    repo.name,
    name,
  );

  return Array.from(versions);
}

export function buildComposerInstallMetadata(repo: Repository) {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  const repoUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
  const repositoryKey = `repositories."${String(repo.name).replace(/"/g, '\\"')}"`;

  return {
    host,
    repoUrl,
    repositoryKey,
  };
}

function normalizeComposerVersion(value: string) {
  return value.endsWith('.zip') ? value.slice(0, -4) : value;
}

async function loadComposerVersions(
  storage: VersionListStorage,
  versions: Set<string>,
  versionIndex: number,
  proxy: boolean,
  repoKey: string,
  name: string,
) {
  const prefix = proxy
    ? buildKey('composer', repoKey, 'proxy', name)
    : buildKey('composer', repoKey, name);

  try {
    const keys = await storage.list(prefix);
    for (const key of keys) {
      const version = extractComposerVersionFromKey(key, versionIndex, proxy);
      if (version) {
        versions.add(version);
      }
    }
  } catch {
    return;
  }
}

function extractComposerVersionFromKey(
  key: string,
  versionIndex: number,
  proxy: boolean,
) {
  const parts = key.split('/');
  const candidateIndex = proxy ? versionIndex + 1 : versionIndex;
  if (parts.length <= candidateIndex) {
    return null;
  }

  return normalizeComposerVersion(parts[candidateIndex]);
}
