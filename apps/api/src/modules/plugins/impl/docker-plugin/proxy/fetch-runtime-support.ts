import type { Repository } from '../utils/types';
import {
  getProxyModuleContext,
  isRecord,
  type DockerProxyFetchResponse,
} from './context';
import {
  isDigestReference,
  type ResolvedDockerProxyRequest,
} from './cache-key';

export async function saveDockerProxyPayload(
  repo: Repository,
  request: ResolvedDockerProxyRequest,
  payload: Buffer,
  status?: number,
): Promise<DockerProxyFetchResponse | null> {
  const { storage } = getProxyModuleContext();
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;

  if (!(request.key && cacheEnabled && cacheMaxAgeDays > 0)) {
    return null;
  }

  try {
    await storage.save(request.key, payload);
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PROXY FETCH SAVED]', {
        storageKey: request.key,
        status,
        bufferSize: payload.length,
      });
    }
    return null;
  } catch (error) {
    return {
      ok: false,
      status: status || 500,
      message: `failed to save to storage: ${String(error)}`,
    };
  }
}

export async function indexDockerManifestArtifact(
  repo: Repository,
  request: ResolvedDockerProxyRequest,
  key: string | null,
  payload: Buffer,
) {
  const { indexArtifact } = getProxyModuleContext();
  if (!request.maniMatch || !request.imgName || !indexArtifact) {
    return;
  }

  const tag = request.maniMatch[1];
  if (isDigestReference(tag)) {
    return;
  }

  const size = calculateDockerManifestSize(payload);
  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug('[PROXY FETCH] Indexing artifact:', {
      name: request.imgName,
      tag,
      size,
      hasBuffer: true,
    });
  }

  try {
    await indexArtifact(repo, {
      ok: true,
      id: `${request.imgName}:${tag}`,
      metadata: {
        name: request.imgName,
        version: tag,
        storageKey: key,
        size,
        type: 'docker/manifest',
      },
    });
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PROXY FETCH] Artifact indexed successfully');
    }
  } catch (error) {
    console.warn(
      '[PROXY FETCH] Failed to index artifact:',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function buildDockerProxySuccessResponse(
  urlStr: string,
  request: ResolvedDockerProxyRequest,
  status: number | undefined,
  payload: Buffer,
): Promise<DockerProxyFetchResponse> {
  const { storage } = getProxyModuleContext();

  if (request.key && typeof storage.getUrl === 'function') {
    try {
      return {
        ok: true,
        url: await storage.getUrl(request.key),
        storageKey: request.key,
        status,
        body: payload,
      };
    } catch {
      return {
        ok: true,
        url: urlStr,
        storageKey: request.key,
        status,
        body: payload,
      };
    }
  }

  return {
    ok: true,
    url: urlStr,
    storageKey: request.key,
    status,
    body: payload,
  };
}

function calculateDockerManifestSize(payload: Buffer): number {
  try {
    const manifest = JSON.parse(payload.toString('utf8'));
    const manifestRecord = isRecord(manifest) ? manifest : {};
    let size = payload.length;

    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PROXY FETCH] Parsed manifest:', {
        hasLayers: !!manifestRecord.layers,
        layersCount: Array.isArray(manifestRecord.layers)
          ? manifestRecord.layers.length
          : 0,
        hasManifests: !!manifestRecord.manifests,
        manifestsCount: Array.isArray(manifestRecord.manifests)
          ? manifestRecord.manifests.length
          : 0,
        hasConfig: !!manifestRecord.config,
        configSize: isRecord(manifestRecord.config)
          ? manifestRecord.config.size
          : undefined,
        mediaType: manifestRecord.mediaType,
        manifestKeys: Object.keys(manifestRecord),
      });
    }

    if (Array.isArray(manifestRecord.manifests)) {
      const manifestsSize = manifestRecord.manifests.reduce(
        (acc: number, entry: unknown) => {
          if (!isRecord(entry) || typeof entry.size !== 'number') {
            return acc;
          }
          return acc + entry.size;
        },
        0,
      );
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug(
          '[PROXY FETCH] Manifest list total size:',
          manifestsSize,
          'manifests:',
          manifestRecord.manifests.map((entry: unknown) => {
            if (!isRecord(entry)) {
              return { platform: undefined, size: undefined };
            }
            return {
              platform: isRecord(entry.platform)
                ? entry.platform.architecture
                : undefined,
              size: entry.size,
            };
          }),
        );
      }
      size += manifestsSize;
    } else if (Array.isArray(manifestRecord.layers)) {
      const layersSize = manifestRecord.layers.reduce(
        (acc: number, entry: unknown) => {
          if (!isRecord(entry) || typeof entry.size !== 'number') {
            return acc;
          }
          return acc + entry.size;
        },
        0,
      );
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug(
          '[PROXY FETCH] Layers total size:',
          layersSize,
          'layers:',
          manifestRecord.layers.map((entry: unknown) => {
            if (!isRecord(entry)) {
              return { digest: undefined, size: undefined };
            }
            return {
              digest:
                typeof entry.digest === 'string'
                  ? entry.digest.substring(0, 20)
                  : undefined,
              size: entry.size,
            };
          }),
        );
      }
      size += layersSize;
    }

    if (
      isRecord(manifestRecord.config) &&
      typeof manifestRecord.config.size === 'number'
    ) {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.debug('[PROXY FETCH] Config size:', manifestRecord.config.size);
      }
      size += manifestRecord.config.size;
    }

    return size;
  } catch (error) {
    console.warn(
      '[PROXY FETCH] Failed to parse manifest for size calculation:',
      error,
    );
    return payload.length;
  }
}
