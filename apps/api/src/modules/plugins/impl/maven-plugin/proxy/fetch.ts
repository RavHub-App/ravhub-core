/*
 * Copyright (C) 2026 RavHub Team
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

import { PluginContext, Repository } from '../utils/types';
import {
  parseMetadata,
  resolveSnapshotVersion,
  parseFilename,
  parseMavenCoordsFromPath,
} from '../utils/maven';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import { buildKey } from '../utils/key-utils';

export function initProxy(context: PluginContext) {
  const proxyFetch = async (repo: Repository, url: string) => {
    try {
      // Check if it is a SNAPSHOT request
      if (url.includes('-SNAPSHOT') && !url.endsWith('maven-metadata.xml')) {
        const parts = url.split('/');
        const filename = parts.pop();
        const version = parts.pop();
        const artifactId = parts.pop();

        if (
          version &&
          version.endsWith('-SNAPSHOT') &&
          filename &&
          artifactId
        ) {
          const metadataUrl = [
            ...parts,
            artifactId,
            version,
            'maven-metadata.xml',
          ].join('/');
          const metadataResult = await proxyFetchWithAuth(repo, metadataUrl);

          if (
            metadataResult.ok &&
            'body' in metadataResult &&
            metadataResult.body
          ) {
            let xml = '';
            if (typeof metadataResult.body === 'string')
              xml = metadataResult.body;

            if (xml) {
              const metadata = parseMetadata(xml);
              const parsed = parseFilename(filename, version, artifactId);
              if (parsed) {
                const resolvedVersion = resolveSnapshotVersion(
                  metadata,
                  parsed.extension,
                  parsed.classifier,
                );
                if (resolvedVersion) {
                  let newFilename = `${artifactId}-${resolvedVersion}`;
                  if (parsed.classifier) newFilename += `-${parsed.classifier}`;
                  newFilename += `.${parsed.extension}${parsed.checksumExt}`;

                  const newUrl = [
                    ...parts,
                    artifactId,
                    version,
                    newFilename,
                  ].join('/');

                  const result = await proxyFetchWithAuth(repo, newUrl);
                  return { ...result, skipCache: true };
                }
              }
            }
          }
        }
      }

      const cleanUrl = url.split('?')[0].split('#')[0];
      const key = buildKey('maven', repo.id, 'proxy', cleanUrl);
      const cacheEnabled = repo.config?.cacheEnabled !== false;

      // Try to get from storage first
      if (context.storage && cacheEnabled) {
        const cached = await context.storage.get(key);
        if (cached) {
          const isXml = cleanUrl.endsWith('.xml') || cleanUrl.endsWith('.pom');
          const isArtifact =
            !isXml &&
            !cleanUrl.endsWith('.sha1') &&
            !cleanUrl.endsWith('.md5') &&
            !cleanUrl.endsWith('.asc');

          if (isArtifact) {
            // Revalidate artifacts with HEAD request
            try {
              const headRes = await proxyFetchWithAuth(repo, url, {
                method: 'HEAD',
                timeoutMs: 5000,
              });
              if (headRes.ok && headRes.headers) {
                const contentLength = headRes.headers['content-length'];
                if (
                  contentLength &&
                  parseInt(contentLength) !== cached.length
                ) {
                  // Fall through to fetch from upstream
                } else {
                  return {
                    ok: true,
                    body: cached,
                    headers: {
                      'content-type': 'application/octet-stream',
                      'content-length': cached.length.toString(),
                      'x-proxy-cache': 'HIT',
                    },
                  };
                }
              } else {
                console.warn(
                  `[MavenPlugin] Revalidation failed (status ${headRes.status}). Serving cache as fallback.`,
                );
                return {
                  ok: true,
                  body: cached,
                  headers: {
                    'content-type': 'application/octet-stream',
                    'content-length': cached.length.toString(),
                    'x-proxy-cache': 'HIT',
                  },
                };
              }
            } catch (revalErr) {
              console.warn(
                `[MavenPlugin] Revalidation error: ${revalErr}. Serving cache as fallback.`,
              );
              return {
                ok: true,
                body: cached,
                headers: {
                  'content-type': 'application/octet-stream',
                  'content-length': cached.length.toString(),
                  'x-proxy-cache': 'HIT',
                },
              };
            }
          } else {
            if (cleanUrl.endsWith('maven-metadata.xml')) {
              const ttlSeconds = repo.config?.cacheTtlSeconds ?? 300;
              try {
                // @ts-ignore - getMetadata exists on FilesystemStorageAdapter
                const meta = await context.storage.getMetadata(key);
                if (meta) {
                  const ageSeconds = (Date.now() - meta.mtime.getTime()) / 1000;
                  if (ageSeconds > ttlSeconds) {
                    throw new Error('Metadata expired');
                  }
                }
              } catch (e) {
                // Fall through to upstream
                throw e;
              }
            }

            return {
              ok: true,
              body: cached,
              headers: {
                'content-type': isXml
                  ? 'application/xml'
                  : 'application/octet-stream',
                'content-length': cached.length.toString(),
                'x-proxy-cache': 'HIT',
              },
            };
          }
        }
      }

      const result = await proxyFetchWithAuth(repo, url);

      // If successful, try to extract metadata for indexing
      if (result.ok) {
        // Save to storage (cache)
        try {
          let content: Buffer | null = null;

          if ('body' in result && result.body) {
            if (Buffer.isBuffer(result.body)) {
              content = result.body;
            } else if (typeof result.body === 'string') {
              content = Buffer.from(result.body);
            } else if (typeof result.body === 'object') {
              content = Buffer.from(JSON.stringify(result.body));
            }
          }

          if (content && context.storage && cacheEnabled) {
            await context.storage.save(key, content);
          }
        } catch (err) {
          console.error('[MavenPlugin] Failed to cache proxy artifact:', err);
        }

        const coords = parseMavenCoordsFromPath(url);
        if (coords) {
          // Only index if it looks like a main artifact (pom, jar, etc)
          // and not metadata or checksums
          const isMetadata =
            url.endsWith('maven-metadata.xml') ||
            url.endsWith('.sha1') ||
            url.endsWith('.md5') ||
            url.endsWith('.asc');

          if (!isMetadata) {
            (result as any).metadata = {
              name: coords.packageName,
              version: coords.version,
              path: url,
            };
          }
        }
      }

      return result;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyFetch };
}
