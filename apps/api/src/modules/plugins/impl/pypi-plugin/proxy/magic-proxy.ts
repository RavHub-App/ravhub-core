/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

import proxyFetchWithAuth, {
  ProxyFetchResult,
} from '../../../../../plugins-core/proxy-helper';
import { buildKey } from '../utils/key-utils';
import { PluginContext, Repository } from '../utils/types';

function normalizePyPiPackageName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_.]+/g, '-');
}

export function derivePyPiArtifactIdentity(filename: string) {
  const archiveName = filename
    .replace(/\.(tar\.gz|whl|zip|egg|bz2)$/i, '')
    .trim();

  if (filename.toLowerCase().endsWith('.whl')) {
    const parts = archiveName.split('-').filter(Boolean);
    return {
      packageName: normalizePyPiPackageName(parts[0] || archiveName),
      version: parts[1] || '0.0.0',
    };
  }

  const parts = archiveName.split('-').filter(Boolean);
  for (let index = parts.length - 1; index > 0; index -= 1) {
    const versionCandidate = parts.slice(index).join('-');
    if (/^\d/.test(versionCandidate)) {
      return {
        packageName: normalizePyPiPackageName(parts.slice(0, index).join('-')),
        version: versionCandidate,
      };
    }
  }

  return {
    packageName: normalizePyPiPackageName(parts[0] || archiveName),
    version: '0.0.0',
  };
}

function buildCanonicalMagicKey(repo: Repository, urlForCache: string) {
  try {
    const filename = urlForCache.split('/').pop();
    if (!filename) return null;
    const { packageName } = derivePyPiArtifactIdentity(filename);
    if (!packageName) return null;
    return buildKey('pypi', repo.id, 'proxy', packageName, filename);
  } catch (error) {
    console.warn(
      `[PyPI] Failed to derive canonical proxy cache key for ${urlForCache}: ${String(error)}`,
    );
    return null;
  }
}

export async function handleMagicProxyFetch(
  context: PluginContext,
  repo: Repository,
  url: string,
): Promise<ProxyFetchResult | null> {
  if (!url.startsWith('pypi-proxy/')) return null;

  const encodedUrl = url.replace('pypi-proxy/', '');
  if (!encodedUrl) return null;

  const targetUrl = decodeURIComponent(encodedUrl);
  const urlForCache = targetUrl.split('#')[0].split('?')[0];
  const canonicalKey = buildCanonicalMagicKey(repo, urlForCache);
  const keyId = buildKey('pypi', repo.id, 'proxy', 'magic', urlForCache);
  const cacheEnabled = repo.config?.cacheEnabled !== false;

  try {
    let cached =
      cacheEnabled && canonicalKey
        ? await context.storage.get(canonicalKey)
        : null;
    if (!cached && cacheEnabled) cached = await context.storage.get(keyId);

    if (cached) {
      try {
        const headRes = await proxyFetchWithAuth(repo, targetUrl, {
          method: 'HEAD',
          timeoutMs: 5000,
        });
        if (headRes.ok && headRes.headers) {
          const contentLength = headRes.headers['content-length'];
          if (!contentLength || parseInt(contentLength) === cached.length) {
            return {
              ok: true,
              status: 200,
              body: cached,
              headers: {
                'content-type': 'application/octet-stream',
                'x-proxy-cache': 'HIT',
              },
            };
          }
        } else {
          console.warn(
            `[PyPI] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
          );
          return {
            ok: true,
            status: 200,
            body: cached,
            headers: {
              'content-type': 'application/octet-stream',
              'x-proxy-cache': 'HIT',
            },
          };
        }
      } catch (revalErr) {
        console.warn(
          `[PyPI] Revalidation error: ${revalErr}. Serving cache as fallback.`,
        );
        return {
          ok: true,
          status: 200,
          body: cached,
          headers: {
            'content-type': 'application/octet-stream',
            'x-proxy-cache': 'HIT',
          },
        };
      }
    }
  } catch {
    return null;
  }

  const result = await proxyFetchWithAuth(repo, targetUrl);

  if (result.ok && 'body' in result && result.body) {
    const body = result.body;
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body as string);
    if (buf.length > 0) {
      const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
      if (cacheEnabled && cacheMaxAgeDays > 0) {
        const storageKey = canonicalKey || keyId;
        try {
          await context.storage.save(storageKey, buf);
          if (context.indexArtifact) {
            const filename = urlForCache.split('/').pop() || 'unknown';
            const { packageName, version } =
              derivePyPiArtifactIdentity(filename);
            await context.indexArtifact(repo, {
              ok: true,
              id: `${packageName}:${version}`,
              metadata: {
                name: packageName,
                version,
                filename,
                storageKey,
                size: buf.length,
              },
            });
          }
        } catch (error) {
          console.error(`[PyPI] Failed to cache ${storageKey}:`, error);
        }
      }
    }

    return { ...result, body: buf };
  }

  return result;
}
