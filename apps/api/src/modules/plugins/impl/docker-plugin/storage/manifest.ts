/**
 * Manifest operations module for Docker plugin
 * Handles putManifest, deleteManifest, and deletePackageVersion operations
 */

import { buildKey } from '../utils/key-utils';
import { normalizeImageName } from '../utils/helpers';
import type { Repository } from '../utils/types';

// Plugin context references (will be set by init)
let storage: any = null;
let getRepo: any = null;
let getBlob: any = null;
let proxyFetch: any = null;
let indexArtifact: any = null;

/**
 * Initialize the manifest module with plugin context
 */
export function initManifest(context: {
  storage: any;
  getRepo?: any;
  getBlob?: any;
  proxyFetch?: any;
  indexArtifact?: any;
}) {
  storage = context.storage;
  getRepo = context.getRepo;
  getBlob = context.getBlob;
  proxyFetch = context.proxyFetch;
  indexArtifact = context.indexArtifact;
}

/**
 * Store a manifest for an image tag
 * Validates that all referenced blobs exist, fetching from upstream if needed
 */
export async function putManifest(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId?: string,
) {
  // PROXY: reject push operations (proxy is read-only from upstream)
  if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
    return {
      ok: false,
      message: 'proxy repositories are read-only (pulls only from upstream)',
    };
  }

  // Check for redeployment policy for hosted repos
  if ((repo?.type || '').toString().toLowerCase() === 'hosted') {
    const allowRedeploy = repo.config?.docker?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const key = buildKey('docker', repo.id, name, `manifests/${tag}`);
      const exists = await storage.exists(key);
      if (exists) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${tag} is not allowed`,
        };
      }
    }
  }

  // GROUP ROUTING: if repo is group, route to target member based on writePolicy
  if ((repo?.type || '').toString().toLowerCase() === 'group') {
    const cfg = (repo?.config || {}) as any;
    const writePolicy = (cfg.writePolicy || 'none').toString().toLowerCase();
    if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
      console.debug(
        `[PUT MANIFEST GROUP] repo=${repo.name}, policy=${writePolicy}, name=${name}, tag=${tag}`,
      );

    if (writePolicy === 'none') {
      return { ok: false, message: 'group writePolicy is none (read-only)' };
    }

    const members: string[] = Array.isArray(cfg.members) ? cfg.members : [];
    if (members.length === 0) {
      return { ok: false, message: 'group has no members' };
    }

    // Helper to get hosted members
    const getHostedMembers = async () => {
      const hosted: Repository[] = [];
      if (!getRepo) return hosted;
      for (const id of members) {
        const m = await getRepo(id);
        if (m && (m.type || '').toString().toLowerCase() === 'hosted')
          hosted.push(m);
      }
      return hosted;
    };

    if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
      const preferredWriter = cfg.preferredWriter;
      if (!preferredWriter) {
        return {
          ok: false,
          message: `writePolicy=${writePolicy} requires preferredWriter`,
        };
      }
      if (!members.includes(preferredWriter)) {
        return { ok: false, message: 'preferredWriter not in members' };
      }
      const targetRepo = await getRepo?.(preferredWriter);
      if (!targetRepo) {
        return {
          ok: false,
          message: `preferredWriter ${preferredWriter} not found`,
        };
      }
      const targetType = (targetRepo.type || '').toString().toLowerCase();
      if (targetType !== 'hosted') {
        return {
          ok: false,
          message: `preferredWriter ${preferredWriter} is not hosted`,
        };
      }

      const result = await putManifest(targetRepo, name, tag, manifest);
      if (result?.ok) {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            groupId: repo.id,
            writePolicy,
            targetRepoId: targetRepo.id,
          },
        };
      }
      return result;
    } else if (writePolicy === 'first') {
      // Try members in order until one succeeds
      for (const mid of members) {
        const child = await getRepo?.(mid);
        if (!child) continue;
        const childType = (child.type || '').toString().toLowerCase();
        if (childType !== 'hosted') continue; // Only hosted can accept writes
        const result = await putManifest(child, name, tag, manifest);
        if (result?.ok) {
          if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
            console.debug(
              `[PUT MANIFEST GROUP FIRST] wrote to ${child.name} (${mid})`,
            );
          return {
            ...result,
            metadata: {
              ...result.metadata,
              groupId: repo.id,
              writePolicy,
              targetRepoId: mid,
            },
          };
        }
      }
      return {
        ok: false,
        message: 'no members accepted write (first policy)',
      };
    } else if (writePolicy === 'mirror') {
      const hosted = await getHostedMembers();
      if (hosted.length === 0)
        return { ok: false, message: 'No hosted members found' };

      const results = await Promise.all(
        hosted.map((m) => putManifest(m, name, tag, manifest)),
      );
      const success = results.find((r) => r.ok);
      if (success) {
        return {
          ...success,
          metadata: {
            ...success.metadata,
            groupId: repo.id,
            writePolicy,
            // We return the first success metadata, but effectively it's on all
          },
        };
      }
      return { ok: false, message: 'Mirror write failed on all members' };
    } else {
      return {
        ok: false,
        message: `unsupported writePolicy: ${writePolicy}`,
      };
    }
  }

  // Validate manifest references (config and layers). If a referenced blob
  // is missing and this repo is a proxy repo, attempt to fetch the blob
  // from the configured upstream/proxy target (prefer config.docker.proxyUrl,
  // falling back to historical keys like config.docker.upstream, config.upstream, etc.).
  try {
    // Validate that all referenced blobs/manifests exist
    const digests: string[] = [];
    const isManifestList =
      manifest.mediaType ===
      'application/vnd.docker.distribution.manifest.list.v2+json' ||
      manifest.mediaType === 'application/vnd.oci.image.index.v1+json' ||
      Array.isArray(manifest.manifests);

    if (isManifestList) {
      // For manifest lists, we check referenced manifests
      if (Array.isArray(manifest.manifests)) {
        for (const m of manifest.manifests) {
          if (m?.digest) digests.push(m.digest);
        }
      }
    } else {
      // For regular manifests, we check config and layers
      if (manifest?.config?.digest) digests.push(manifest.config.digest);
      if (Array.isArray(manifest?.layers)) {
        for (const l of manifest.layers) if (l?.digest) digests.push(l.digest);
      }
    }

    for (const d of digests) {
      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug('[PUT MANIFEST] checking digest', d);
      // try to find the blob in storage via getBlob
      const existing = await getBlob?.(repo, name, d);
      if (existing?.ok) continue;

      // if repo is a proxy, attempt to pull from upstream
      const isProxy = (repo?.type || '').toString().toLowerCase() === 'proxy';
      // For hosted (non-proxy) repos we allow storing manifests even if
      // referenced blobs are missing (some registries accept manifests
      // before blobs arrive). For proxy repos, attempt to fetch the blob.
      if (!isProxy) {
        // If it's a manifest list, we might want to be stricter?
        // But standard behavior is to allow it.
        // However, if we are missing the referenced manifest, the client might fail to pull it later.
        // For now, we warn but proceed for hosted.
        if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
          console.warn(`[PUT MANIFEST] missing referenced item ${d} in hosted repo`);
        continue;
      }

      // construct upstream base URL
      const target =
        (repo?.config?.docker?.proxyUrl as string) ||
        (repo?.config?.docker?.upstream as string) ||
        repo?.config?.target ||
        repo?.config?.registry ||
        null;
      if (!target)
        return {
          ok: false,
          message: `missing blob ${d} and no upstream configured`,
        };

      // Normalize for Docker Hub (official images require `library/` prefix)
      const normalizedName = normalizeImageName(
        String(name),
        String(target),
        repo,
      );
      const encodedName = String(normalizedName)
        .split('/')
        .map((s) => encodeURIComponent(s))
        .join('/');

      // Determine if we should fetch as blob or manifest
      // If we are processing a manifest list, the children are manifests.
      // Otherwise, they are config/layers (blobs).
      let upstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/blobs/${encodeURIComponent(d)}`;
      if (isManifestList) {
        upstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/manifests/${encodeURIComponent(d)}`;
      }

      let fetched = await proxyFetch?.(repo, upstream);

      // Fallback: if fetching as manifest failed (or vice versa), try the other endpoint
      // Some registries might serve everything as blobs or be strict.
      if (!fetched?.ok && isManifestList) {
        // Try as blob
        const altUpstream = `${target.replace(/\/$/, '')}/v2/${encodedName}/blobs/${encodeURIComponent(d)}`;
        fetched = await proxyFetch?.(repo, altUpstream);
      } else if (!fetched?.ok && !isManifestList) {
        // Try as manifest (unlikely for layers, but possible for config if it's treated as such?)
        // Actually, layers are always blobs. Config is a blob.
        // So no fallback needed for regular manifests usually.
      }

      if (process.env.DEBUG_DOCKER_PLUGIN === 'true')
        console.debug('[PUT MANIFEST] fetched result', fetched);
      if (!fetched?.ok)
        return { ok: false, message: `failed fetching ${d} from upstream` };
      // fetched and saved to storage
    }

    const data = JSON.stringify(manifest);
    // compute a content digest for the manifest so Docker can verify/accept it
    const crypto = require('crypto');
    let manifestDigest: string | undefined;
    try {
      const sum = crypto
        .createHash('sha256')
        .update(Buffer.from(data, 'utf8'))
        .digest('hex');
      manifestDigest = `sha256:${sum}`;
    } catch (e) {
      // ignore
    }
    const key = buildKey('docker', repo.id, name, `manifests/${tag}`);
    await storage.save(key, data);
    // Also save by digest so it can be retrieved by digest later
    if (manifestDigest) {
      const digestKey = buildKey(
        'docker',
        repo.id,
        name,
        `manifests/${manifestDigest}`,
      );
      await storage.save(digestKey, data);
    }

    // Index artifact in database
    if (indexArtifact) {
      try {
        // Calculate manifest size
        let totalSize = Buffer.byteLength(data, 'utf8');
        if (Array.isArray(manifest?.layers)) {
          totalSize += manifest.layers.reduce(
            (acc: number, l: any) => acc + (l.size || 0),
            0,
          );
        }
        if (manifest?.config?.size) {
          totalSize += manifest.config.size;
        }

        await indexArtifact(repo, {
          ok: true,
          id: `${name}:${tag}`,
          metadata: {
            name,
            version: tag,
            storageKey: key,
            digest: manifestDigest,
            size: totalSize,
            type: 'docker/manifest',
          },
        }, userId);
      } catch (err: any) {
        console.warn('[PUT MANIFEST] Failed to index artifact:', err.message);
      }
    }

    return {
      ok: true,
      metadata: { storageKey: key, digest: manifestDigest },
    };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Delete a manifest by digest
 */
export async function deleteManifest(
  repo: Repository,
  name: string,
  digest: string,
) {
  try {
    const key = buildKey('docker', repo.id, name, `manifests/${digest}`);
    const exists = await storage.exists(key);
    if (!exists) return { ok: false, message: 'not found' };
    await storage.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Delete a package version (tag)
 * NOTE: This only removes the tag, not the underlying layers (blobs).
 * Docker layers are content-addressable and may be shared across multiple images/tags.
 */
export async function deletePackageVersion(
  repo: Repository,
  name: string,
  version: string,
) {
  try {
    // Delete the tag reference (manifest pointer)
    // NOTE: This only removes the tag, not the underlying layers (blobs).
    // Docker layers are content-addressable and may be shared across multiple images/tags.
    // Deleting layers automatically could break other images that reference them.
    // Behavior:
    // - Deleting a tag (e.g., "latest") removes only that tag reference
    // - Other tags of the same image remain unaffected
    // - Shared layers remain in storage
    // - A separate garbage collection process would be needed to clean up orphaned layers

    const key = buildKey('docker', repo.id, name, `manifests/${version}`);
    const exists = await storage.exists(key);
    if (!exists) return { ok: false, message: 'version not found' };
    await storage.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}
