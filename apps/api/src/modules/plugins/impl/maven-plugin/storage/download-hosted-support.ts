import * as crypto from 'crypto';
import { buildKey } from '../utils/key-utils';
import { Repository } from '../utils/types';
import {
  checksumAlgoForPath,
  getContentTypeByPath,
  stripChecksumExt,
} from './storage-helpers';
import type { DownloadResult } from './download-support';

type StorageLike = {
  get: (key: string) => Promise<Buffer | null>;
};

export async function downloadHostedMavenArtifact(
  storage: StorageLike,
  repo: Repository,
  normalizedPath: string,
): Promise<DownloadResult> {
  const checksumAlgo = checksumAlgoForPath(normalizedPath);
  if (checksumAlgo) {
    return readMavenChecksum(storage, repo, normalizedPath, checksumAlgo);
  }

  try {
    const data = await readStoredArtifact(storage, repo, normalizedPath);
    if (!data) {
      return { ok: false, message: 'Not found' };
    }

    return {
      ok: true,
      data,
      contentType: getContentTypeByPath(normalizedPath),
    };
  } catch (error) {
    console.warn(
      `[Maven] Failed to read artifact ${normalizedPath}: ${String(error)}`,
    );
    return { ok: false, message: 'Not found' };
  }
}

async function readMavenChecksum(
  storage: StorageLike,
  repo: Repository,
  normalizedPath: string,
  checksumAlgo: 'sha1' | 'md5' | 'sha256',
): Promise<DownloadResult> {
  try {
    const existing = await readStoredArtifact(storage, repo, normalizedPath);
    if (existing) {
      return { ok: true, data: existing, contentType: 'text/plain' };
    }
  } catch (error) {
    console.warn(
      `[Maven] Failed to read stored checksum ${normalizedPath}: ${String(error)}`,
    );
  }

  const basePath = stripChecksumExt(normalizedPath);

  try {
    const base = await readStoredArtifact(storage, repo, basePath);
    if (!base) {
      return { ok: false, message: 'Not found' };
    }

    const sum =
      crypto.createHash(checksumAlgo).update(base).digest('hex') + '\n';
    return {
      ok: true,
      data: Buffer.from(sum),
      contentType: 'text/plain',
    };
  } catch (error) {
    console.warn(
      `[Maven] Failed to calculate checksum ${normalizedPath}: ${String(error)}`,
    );
    return { ok: false, message: 'Not found' };
  }
}

async function readStoredArtifact(
  storage: StorageLike,
  repo: Repository,
  normalizedPath: string,
) {
  const storageKeyId = buildKey('maven', repo.id, normalizedPath);
  const storageKeyName = buildKey('maven', repo.name, normalizedPath);

  let data = await storage.get(storageKeyId).catch(() => null);
  if (!data) {
    data = await storage.get(storageKeyName).catch(() => null);
  }

  return data;
}
