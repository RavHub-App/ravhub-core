import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import type { PluginContext, Repository } from '../utils/types';
import type { ProxyResponse } from './fetch-cache';

export async function revalidateCachedMavenArtifact(
  repo: Repository,
  upstreamRequestUrl: string,
  cached: Buffer,
) {
  try {
    const headResponse = await proxyFetchWithAuth(repo, upstreamRequestUrl, {
      method: 'HEAD',
      timeoutMs: 5000,
    });
    if (headResponse.ok && headResponse.headers) {
      const contentLength = headResponse.headers['content-length'];
      if (!contentLength || parseInt(contentLength) === cached.length) {
        return createMavenArtifactCacheHit(cached);
      }

      return null;
    }

    console.warn(
      `[MavenPlugin] Revalidation failed (status ${headResponse.status}). Serving cache as fallback.`,
    );
    return createMavenArtifactCacheHit(cached);
  } catch (error) {
    console.warn(
      `[MavenPlugin] Revalidation error: ${error}. Serving cache as fallback.`,
    );
    return createMavenArtifactCacheHit(cached);
  }
}

export async function shouldRefreshMavenMetadata(
  context: PluginContext,
  repo: Repository,
  cleanUrl: string,
  key: string,
) {
  if (!cleanUrl.endsWith('maven-metadata.xml')) {
    return false;
  }

  const ttlSeconds = repo.config?.cacheTtlSeconds ?? 300;
  try {
    const storageWithMetadata = context.storage as typeof context.storage & {
      getMetadata?: (storageKey: string) => Promise<{ mtime: Date } | null>;
    };
    const meta = await storageWithMetadata.getMetadata?.(key);
    if (!meta) {
      return false;
    }

    const ageSeconds = (Date.now() - meta.mtime.getTime()) / 1000;
    return ageSeconds > ttlSeconds;
  } catch {
    return true;
  }
}

export function toMavenProxyBuffer(body: ProxyResponse['body']) {
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (typeof body === 'string') {
    return Buffer.from(body);
  }
  if (typeof body === 'object' && body) {
    return Buffer.from(JSON.stringify(body));
  }
  return null;
}

export function isMavenIndexingExcluded(cleanUrl: string) {
  return (
    cleanUrl.endsWith('maven-metadata.xml') ||
    cleanUrl.endsWith('.sha1') ||
    cleanUrl.endsWith('.md5') ||
    cleanUrl.endsWith('.asc')
  );
}

function createMavenArtifactCacheHit(cached: Buffer) {
  return {
    ok: true,
    body: cached,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': cached.length.toString(),
      'x-proxy-cache': 'HIT',
    },
  } as const;
}
