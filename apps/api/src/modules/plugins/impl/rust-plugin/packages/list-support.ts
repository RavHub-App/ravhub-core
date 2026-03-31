import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type VersionListStorage = {
  list: (prefix: string) => Promise<string[]>;
};

export async function collectRustPackageVersions(
  storage: VersionListStorage,
  repo: Repository,
  name: string,
) {
  const versions = new Set<string>();

  await loadRustVersions(storage, versions, repo.id, 'crates', name);
  await loadRustVersions(storage, versions, repo.name, 'crates', name);

  if (repo.type === 'proxy') {
    await loadRustVersions(storage, versions, repo.id, 'proxy', name);
    await loadRustVersions(storage, versions, repo.name, 'proxy', name);
  }

  return Array.from(versions);
}

export function buildRustInstallMetadata(repo: Repository) {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  const indexUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}/index`;
  const registryName = repo.name.replace(/"/g, '\\"');

  return {
    indexUrl,
    registryName,
  };
}

async function loadRustVersions(
  storage: VersionListStorage,
  versions: Set<string>,
  ...keyParts: string[]
) {
  const prefix = buildKey('rust', ...keyParts);
  try {
    const keys = await storage.list(prefix);
    for (const key of keys) {
      const version = extractRustVersionFromKey(key);
      if (version) {
        versions.add(version);
      }
    }
  } catch {
    return;
  }
}

function extractRustVersionFromKey(key: string) {
  const parts = key.split('/');

  if (parts.length >= 6 && parts[2] === 'crates') {
    return decodeURIComponent(parts[4]);
  }

  if (parts.length >= 6 && parts[2] === 'proxy') {
    return decodeURIComponent(parts[4]);
  }

  return null;
}
