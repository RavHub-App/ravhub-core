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

import { buildKey } from '../utils/key-utils';
import { normalizeImageName } from '../utils/helpers';
import type { Repository } from '../utils/types';

export async function writeManifest(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId: string | undefined,
  dependencies: {
    storage: any;
    getBlob: any;
    proxyFetch: any;
    indexArtifact: any;
  },
) {
  await validateManifestReferences(repo, name, manifest, dependencies);

  const data = JSON.stringify(manifest);
  const manifestDigest = computeManifestDigest(data);
  const key = buildKey('docker', repo.id, name, `manifests/${tag}`);

  await dependencies.storage.save(key, data);
  if (manifestDigest) {
    const digestKey = buildKey(
      'docker',
      repo.id,
      name,
      `manifests/${manifestDigest}`,
    );
    await dependencies.storage.save(digestKey, data);
  }

  await tryIndexManifest(
    repo,
    name,
    tag,
    manifest,
    data,
    key,
    manifestDigest,
    userId,
    dependencies.indexArtifact,
  );

  return {
    ok: true,
    metadata: { storageKey: key, digest: manifestDigest },
  };
}

async function validateManifestReferences(
  repo: Repository,
  name: string,
  manifest: any,
  dependencies: {
    getBlob: any;
    proxyFetch: any;
  },
) {
  const isManifestList =
    manifest.mediaType ===
      'application/vnd.docker.distribution.manifest.list.v2+json' ||
    manifest.mediaType === 'application/vnd.oci.image.index.v1+json' ||
    Array.isArray(manifest.manifests);

  const digests = collectReferencedDigests(manifest, isManifestList);
  for (const digest of digests) {
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
      console.debug('[PUT MANIFEST] checking digest', digest);
    }

    const existing = await dependencies.getBlob?.(repo, name, digest);
    if (existing?.ok) {
      continue;
    }

    const isProxyRepo = (repo?.type || '').toString().toLowerCase() === 'proxy';
    if (!isProxyRepo) {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
        console.warn(
          `[PUT MANIFEST] missing referenced item ${digest} in hosted repo`,
        );
      }
      continue;
    }

    await fetchMissingReferenceFromUpstream(
      repo,
      name,
      digest,
      isManifestList,
      dependencies.proxyFetch,
    );
  }
}

function collectReferencedDigests(manifest: any, isManifestList: boolean) {
  const digests: string[] = [];

  if (isManifestList) {
    if (Array.isArray(manifest.manifests)) {
      for (const item of manifest.manifests) {
        if (item?.digest) {
          digests.push(item.digest);
        }
      }
    }
    return digests;
  }

  if (manifest?.config?.digest) {
    digests.push(manifest.config.digest);
  }

  if (Array.isArray(manifest?.layers)) {
    for (const layer of manifest.layers) {
      if (layer?.digest) {
        digests.push(layer.digest);
      }
    }
  }

  return digests;
}

async function fetchMissingReferenceFromUpstream(
  repo: Repository,
  name: string,
  digest: string,
  isManifestList: boolean,
  proxyFetch: any,
) {
  const target =
    (repo?.config?.docker?.proxyUrl as string) ||
    (repo?.config?.docker?.upstream as string) ||
    repo?.config?.target ||
    repo?.config?.registry ||
    null;

  if (!target) {
    throw new Error(`missing blob ${digest} and no upstream configured`);
  }

  const normalizedName = normalizeImageName(String(name), String(target), repo);
  const encodedName = String(normalizedName)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');

  let upstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/blobs/${encodeURIComponent(digest)}`;
  if (isManifestList) {
    upstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/manifests/${encodeURIComponent(digest)}`;
  }

  let fetched = await proxyFetch?.(repo, upstream);
  if (!fetched?.ok && isManifestList) {
    const fallbackUpstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/blobs/${encodeURIComponent(digest)}`;
    fetched = await proxyFetch?.(repo, fallbackUpstream);
  }

  if (process.env.DEBUG_DOCKER_PLUGIN === 'true') {
    console.debug('[PUT MANIFEST] fetched result', fetched);
  }

  if (!fetched?.ok) {
    throw new Error(`failed fetching ${digest} from upstream`);
  }
}

function computeManifestDigest(data: string) {
  try {
    const crypto = require('crypto');
    const sum = crypto
      .createHash('sha256')
      .update(Buffer.from(data, 'utf8'))
      .digest('hex');
    return `sha256:${sum}`;
  } catch {
    return undefined;
  }
}

async function tryIndexManifest(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  data: string,
  storageKey: string,
  digest: string | undefined,
  userId: string | undefined,
  indexArtifact: any,
) {
  if (!indexArtifact) {
    return;
  }

  try {
    let totalSize = Buffer.byteLength(data, 'utf8');
    if (Array.isArray(manifest?.layers)) {
      totalSize += manifest.layers.reduce(
        (acc: number, layer: any) => acc + (layer.size || 0),
        0,
      );
    }
    if (manifest?.config?.size) {
      totalSize += manifest.config.size;
    }

    await indexArtifact(
      repo,
      {
        ok: true,
        id: `${name}:${tag}`,
        metadata: {
          name,
          version: tag,
          storageKey,
          digest,
          size: totalSize,
          type: 'docker/manifest',
        },
      },
      userId,
    );
  } catch (error: any) {
    console.warn('[PUT MANIFEST] Failed to index artifact:', error.message);
  }
}
