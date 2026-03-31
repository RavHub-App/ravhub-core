import type { PluginContext, Repository } from '../utils/types';

type PyPiStorage = PluginContext['storage'];

export async function ensurePyPiUploadRedeployAllowed(
  storage: PyPiStorage,
  allowRedeploy: boolean,
  keyId: string,
  keyName: string,
  name: string,
  version: string,
) {
  if (allowRedeploy) {
    return null;
  }

  const existingId = await storage.get(keyId).catch(() => null);
  const existingName = await storage.get(keyName).catch(() => null);
  if (!(existingId || existingName)) {
    return null;
  }

  return {
    ok: false,
    message: `Redeployment of ${name}:${version} is not allowed`,
  };
}

export async function ensurePyPiPutRedeployAllowed(
  storage: PyPiStorage,
  allowRedeploy: boolean,
  keyId: string,
  keyName: string,
  name: string,
  version: string,
) {
  if (allowRedeploy) {
    return null;
  }

  const existsById = await storage.exists(keyId).catch(() => false);
  const existsByName = await storage.exists(keyName).catch(() => false);
  if (!(existsById || existsByName)) {
    return null;
  }

  return {
    ok: false,
    message: `Redeployment of ${name}:${version} is not allowed`,
  };
}

export async function buildPyPiArtifactResult(
  context: PluginContext,
  repo: Repository,
  action: 'uploaded' | 'put',
  name: string,
  version: string,
  keyId: string,
  size: number,
  contentHash?: string,
) {
  const artifactResult = {
    ok: true,
    id: `${name}:${version}`,
    metadata: {
      name,
      version,
      storageKey: keyId,
      size,
      contentHash,
    },
  };

  if (context.indexArtifact) {
    try {
      await context.indexArtifact(repo, artifactResult);
    } catch (error) {
      console.warn(
        `[PyPIPlugin] Failed to index ${action} artifact ${name}:${version}: ${String(error)}`,
      );
    }
  }

  return artifactResult;
}
