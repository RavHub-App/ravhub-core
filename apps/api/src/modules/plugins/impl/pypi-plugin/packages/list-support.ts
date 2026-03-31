import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type VersionListStorage = {
  list: (prefix: string) => Promise<string[]>;
};

export async function collectPypiPackageVersions(
  storage: VersionListStorage,
  repo: Repository,
  name: string,
) {
  const versions = new Set<string>();

  await loadPypiVersions(storage, versions, repo.id, name);
  await loadPypiVersions(storage, versions, repo.name, name);

  return Array.from(versions);
}

export function buildPypiInstallMetadata(repo: Repository) {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  const indexUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}/simple`;
  const sourceName = repo.name.replace(/"/g, '\\"');

  return {
    host,
    indexUrl,
    sourceName,
  };
}

async function loadPypiVersions(
  storage: VersionListStorage,
  versions: Set<string>,
  repoKey: string,
  name: string,
) {
  const prefix = buildKey('pypi', repoKey, name);
  try {
    const keys = await storage.list(prefix);
    for (const key of keys) {
      const version = extractPypiVersionFromKey(key);
      if (version) {
        versions.add(version);
      }
    }
  } catch {
    return;
  }
}

function extractPypiVersionFromKey(key: string) {
  const parts = key.split('/');
  return parts.length >= 4 ? parts[3] : null;
}
