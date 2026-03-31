import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';

type VersionListStorage = {
  list: (prefix: string) => Promise<string[]>;
};

export function parseMavenPackageCoordinates(name: string) {
  let groupId: string;
  let artifactId: string;

  if (name.includes(':')) {
    [groupId, artifactId] = name.split(':');
  } else {
    const parts = name.split('/');
    artifactId = parts.pop() || '';
    groupId = parts.join('/');
  }

  if (!groupId || !artifactId) {
    return null;
  }

  return {
    groupId,
    artifactId,
    artifactPath: `${groupId.replace(/\./g, '/')}/${artifactId}`,
  };
}

export async function collectMavenPackageVersions(
  storage: VersionListStorage,
  repo: Repository,
  artifactPath: string,
) {
  const versions = new Set<string>();

  await tryLoadMavenVersions(storage, repo.id, artifactPath, versions);
  await tryLoadMavenVersions(storage, repo.name, artifactPath, versions);

  return Array.from(versions);
}

export function resolveMavenInstallCoordinates(name: string) {
  let groupId = 'com.example';
  let artifactId = 'artifact';

  if (name.includes(':')) {
    const parts = name.split(':');
    if (parts[0]) groupId = parts[0];
    if (parts[1]) artifactId = parts[1];
    return { groupId, artifactId };
  }

  const parts = name.split('/');
  if (parts.length > 0) {
    artifactId = parts.pop() || artifactId;
    if (parts.length > 0) {
      groupId = parts.join('.');
    }
  }

  return { groupId, artifactId };
}

async function tryLoadMavenVersions(
  storage: VersionListStorage,
  repoIdOrName: string,
  artifactPath: string,
  versions: Set<string>,
) {
  const prefixes = [
    buildKey('maven', repoIdOrName, artifactPath),
    buildKey('maven', repoIdOrName, 'proxy', artifactPath),
  ];

  for (const prefix of prefixes) {
    try {
      const keys = await storage.list(prefix);
      for (const key of keys) {
        const version = extractMavenVersionFromKey(key, prefix);
        if (version) {
          versions.add(version);
        }
      }
    } catch (error) {
      console.error('[MavenPlugin] listVersions error:', error);
    }
  }
}

function extractMavenVersionFromKey(key: string, prefix: string) {
  if (!key.startsWith(prefix)) {
    return null;
  }

  let suffix = key.slice(prefix.length);
  if (suffix.startsWith('/')) {
    suffix = suffix.slice(1);
  }

  const parts = suffix.split('/');
  const version = parts[0];
  if (
    !version ||
    version === 'maven-metadata.xml' ||
    version.endsWith('.xml') ||
    version.endsWith('.asc') ||
    version.endsWith('.sha1') ||
    version.endsWith('.md5') ||
    parts.length <= 1
  ) {
    return null;
  }

  return version;
}
