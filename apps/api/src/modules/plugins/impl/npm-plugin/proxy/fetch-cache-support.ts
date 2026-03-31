import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import type { PluginContext, Repository } from '../utils/types';
import type { MetadataProcessor, NpmProxyRequest } from './fetch-cache';

export async function revalidateCachedNpmTarball(
  repo: Repository,
  upstreamRequestUrl: string,
  cachedData: Buffer,
) {
  try {
    const headResponse = await proxyFetchWithAuth(repo, upstreamRequestUrl, {
      method: 'HEAD',
      timeoutMs: 5000,
    });
    if (headResponse.ok && headResponse.headers) {
      const contentLength = headResponse.headers['content-length'];
      if (contentLength && parseInt(contentLength) !== cachedData.length) {
        return null;
      }
    }

    return createTarballCacheHit(cachedData);
  } catch {
    return createTarballCacheHit(cachedData);
  }
}

export async function readCachedNpmMetadata(
  context: PluginContext,
  repo: Repository,
  proxyKey: string,
  cachedData: Buffer,
  processMetadata: MetadataProcessor,
) {
  const ttlSeconds = repo.config?.cacheTtlSeconds ?? 300;
  const metadata =
    typeof context.storage.getMetadata === 'function'
      ? await context.storage.getMetadata(proxyKey).catch(() => null)
      : null;
  if (!metadata) {
    return null;
  }

  const ageSeconds = (Date.now() - metadata.mtime.getTime()) / 1000;
  if (ageSeconds > ttlSeconds) {
    return null;
  }

  let body: Buffer | unknown = cachedData;
  try {
    body = processMetadata(repo, cachedData);
  } catch (error) {
    console.warn(
      '[NPM_PROXY] Failed to process cached metadata. Serving raw cache.',
      error,
    );
  }

  return {
    ok: true,
    status: 200,
    headers: {
      'content-type': 'application/json',
      'x-proxy-cache': 'HIT',
    },
    body,
  } as const;
}

export async function saveNpmProxyPayload(
  context: PluginContext,
  repo: Repository,
  request: NpmProxyRequest,
  body: unknown,
  proxyKey: string,
) {
  const cacheEnabled = repo.config?.cacheEnabled !== false;
  const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
  if (!cacheEnabled || cacheMaxAgeDays <= 0) {
    return;
  }

  let dataToSave = body;
  if (typeof dataToSave === 'object' && !Buffer.isBuffer(dataToSave)) {
    dataToSave = JSON.stringify(dataToSave);
  }

  await context.storage.save(proxyKey, dataToSave as string | Buffer);
  await indexCachedNpmTarball(
    context,
    repo,
    request.storagePath,
    proxyKey,
    dataToSave,
  );
}

function createTarballCacheHit(cachedData: Buffer) {
  return {
    ok: true,
    status: 200,
    headers: {
      'content-type': 'application/octet-stream',
      'x-proxy-cache': 'HIT',
    },
    body: cachedData,
  } as const;
}

async function indexCachedNpmTarball(
  context: PluginContext,
  repo: Repository,
  storagePath: string,
  proxyKey: string,
  dataToSave: string | Buffer | unknown,
) {
  if (!(storagePath.endsWith('.tgz') && context.indexArtifact)) {
    return;
  }

  try {
    await context.indexArtifact(repo, {
      ok: true,
      id: storagePath,
      metadata: {
        storageKey: proxyKey,
        size: Buffer.isBuffer(dataToSave)
          ? dataToSave.length
          : Buffer.byteLength(String(dataToSave)),
        path: storagePath,
      },
    });
  } catch (error) {
    console.warn('[NPM_PROXY] Failed to index cached tarball artifact.', error);
  }
}
