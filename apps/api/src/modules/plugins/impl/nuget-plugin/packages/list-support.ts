import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type VersionListStorage = {
  list: (prefix: string) => Promise<string[]>;
};

export async function collectNugetPackageVersions(
  storage: VersionListStorage,
  repo: Repository,
  name: string,
) {
  const versions = new Set<string>();

  await tryLoadNugetVersions(storage, versions, repo.id, name);
  await tryLoadNugetVersions(storage, versions, repo.name, name);

  if (repo.type === 'proxy') {
    await tryLoadNugetVersions(storage, versions, repo.id, 'proxy', name);
    await tryLoadNugetVersions(storage, versions, repo.name, 'proxy', name);
  }

  return Array.from(versions);
}

export function buildNugetInstallSource(repo: Repository) {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  return `${proto}://${host}/repository/${encodeURIComponent(repo.name)}/index.json`;
}

export function escapeNugetXmlAttribute(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/'/g, '&apos;');
}

async function tryLoadNugetVersions(
  storage: VersionListStorage,
  versions: Set<string>,
  ...keyParts: string[]
) {
  const prefix = buildKey('nuget', ...keyParts);
  try {
    const keys = await storage.list(prefix);
    for (const key of keys) {
      const version = extractNugetVersionFromKey(key);
      if (version) {
        versions.add(version);
      }
    }
  } catch {
    return;
  }
}

function extractNugetVersionFromKey(key: string) {
  const parts = key.split('/');

  if (parts.length >= 6 && parts[2] === 'proxy') {
    return parts[4];
  }

  if (parts.length >= 4) {
    return parts[3];
  }

  return null;
}
