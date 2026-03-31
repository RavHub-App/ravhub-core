import { buildKey } from '../utils/key-utils';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import type { PluginContext, Repository } from '../utils/types';
import {
  getIndexPath,
  getSha256,
  mapDependencies,
  parseCrateMetadata,
} from './storage-helpers';

type RustStorage = PluginContext['storage'];

export async function updateRustIndexEntry(
  context: PluginContext,
  storage: RustStorage,
  repo: Repository,
  name: string,
  version: string,
  buf: Buffer,
  meta: any,
) {
  const repoId = repo.id;
  const lockKey = `rust:index:${repoId}`;

  return await runWithLock(context, lockKey, async () => {
    const relPath = getIndexPath(name);
    const key = buildKey('rust', repo.id, 'index', relPath);

    const entry = await buildRustIndexEntry(name, version, buf, meta);
    const line = JSON.stringify(entry);

    let content = '';
    try {
      const existing = await storage.get(key);
      if (existing) {
        content = existing.toString() + '\n';
      }
    } catch (error) {
      console.warn(
        `[Rust] Failed to read existing index for ${name}: ${String(error)}`,
      );
    }

    if (!content.includes(`"vers":"${version}"`)) {
      content += line;
      await storage.save(key, Buffer.from(content));
    }
  });
}

export async function buildRustUploadResult(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string,
  keyId: string,
  buf: Buffer,
  saveResult: { size?: number; contentHash?: string },
) {
  const uploadResult = {
    ok: true,
    id: `${name}:${version}`,
    metadata: {
      name,
      version,
      storageKey: keyId,
      size: saveResult.size ?? buf.length,
      contentHash: saveResult.contentHash,
    },
  };

  if (context.indexArtifact) {
    try {
      await context.indexArtifact(repo, uploadResult);
    } catch (error) {
      console.error('[Rust] Failed to index artifact:', error);
    }
  }

  return uploadResult;
}

async function buildRustIndexEntry(
  name: string,
  version: string,
  buf: Buffer,
  meta: any,
) {
  let finalDeps = meta.deps;
  let finalFeatures = meta.features;
  if (!finalDeps || !finalFeatures) {
    const cargo = await parseCrateMetadata(buf);
    if (cargo) {
      if (!finalDeps) finalDeps = mapDependencies(cargo);
      if (!finalFeatures) finalFeatures = cargo.features || {};
    }
  }

  return {
    name,
    vers: version,
    deps: finalDeps || [],
    cksum: getSha256(buf),
    features: finalFeatures || {},
    yanked: false,
    links: meta.links || undefined,
  };
}
