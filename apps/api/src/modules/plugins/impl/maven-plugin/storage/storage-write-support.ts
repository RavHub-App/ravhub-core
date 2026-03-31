import { buildKey } from '../utils/key-utils';
import { parseMavenCoordsFromPath } from '../utils/maven';
import { PluginContext, Repository } from '../utils/types';
import { checksumAlgoForPath } from './storage-helpers';

type MavenStorage = PluginContext['storage'];

type MavenArtifactDescriptor = {
  repoPath: string;
  keyId: string;
  keyName: string;
  packageName: string;
  version: string;
  isSnapshot: boolean;
  isMetadataOrChecksum: boolean;
};

type MavenStoredArtifactResult = {
  ok: true;
  id: string;
  metadata: {
    name?: string;
    version?: string;
    path: string;
    storageKey: string;
    size?: number;
    contentHash?: string;
  };
};

type SaveResult = {
  size?: number;
  contentHash?: string;
};

export function describeMavenArtifact(
  repo: Repository,
  repoPath: string,
  pkg?: {
    packageName?: string;
    coordinates?: string;
    version?: string;
  },
): MavenArtifactDescriptor {
  const coords = parseMavenCoordsFromPath(repoPath);
  const packageName =
    coords?.packageName ||
    pkg?.packageName ||
    pkg?.coordinates ||
    'com.example:artifact';
  const version = coords?.version || pkg?.version || '1.0.0';

  return {
    repoPath,
    keyId: buildKey('maven', repo.id, repoPath),
    keyName: buildKey('maven', repo.name, repoPath),
    packageName,
    version,
    isSnapshot: String(version).toUpperCase().endsWith('-SNAPSHOT'),
    isMetadataOrChecksum:
      repoPath.toLowerCase().endsWith('maven-metadata.xml') ||
      checksumAlgoForPath(repoPath) !== null ||
      repoPath.toLowerCase().endsWith('.asc'),
  };
}

export async function hasMavenRedeployConflict(
  storage: MavenStorage,
  artifact: MavenArtifactDescriptor,
  checkByName: boolean,
): Promise<boolean> {
  const existsId = await storage.exists(artifact.keyId);
  if (existsId) {
    return true;
  }

  if (!checkByName) {
    return false;
  }

  return storage.exists(artifact.keyName);
}

export function buildMavenStoredArtifactResult(
  artifact: MavenArtifactDescriptor,
  saveResult: SaveResult,
): MavenStoredArtifactResult {
  return {
    ok: true,
    id: artifact.repoPath,
    metadata: {
      name: artifact.packageName,
      version: artifact.version,
      path: artifact.repoPath,
      storageKey: artifact.keyId,
      size: saveResult.size,
      contentHash: saveResult.contentHash,
    },
  };
}

export async function indexMavenArtifact(
  context: PluginContext,
  repo: Repository,
  artifact: MavenArtifactDescriptor,
  result: MavenStoredArtifactResult,
) {
  if (
    !context.indexArtifact ||
    artifact.isMetadataOrChecksum ||
    !artifact.packageName ||
    !artifact.version
  ) {
    return;
  }

  try {
    await context.indexArtifact(repo, result);
  } catch (error) {
    console.error('[Maven] Failed to index artifact:', error);
  }
}
