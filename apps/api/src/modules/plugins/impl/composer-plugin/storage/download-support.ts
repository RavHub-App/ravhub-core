import { initMetadata } from '../proxy/metadata';
import { buildKey } from '../utils/key-utils';
import type { PluginContext, Repository } from '../utils/types';
import type { ComposerDownloadResult } from './write';

type ComposerConfig = {
  members?: string[];
  proxyUrl?: string;
};

export async function downloadFromComposerGroup(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string | undefined,
  download: (
    repo: Repository,
    name: string,
    version?: string,
  ) => Promise<ComposerDownloadResult>,
): Promise<ComposerDownloadResult> {
  const members = ((repo.config ?? {}) as ComposerConfig).members || [];

  for (const id of members) {
    try {
      const member = (await context.getRepo?.(id)) as Repository | null;
      if (!member) {
        continue;
      }

      const result = await download(member, name, version);
      if (result.ok) {
        return result;
      }
    } catch (error) {
      console.warn(
        `[Composer] Group download failed for member ${id}: ${String(error)}`,
      );
    }
  }

  return { ok: false, message: 'Not found in group' };
}

export function parseComposerArtifactCoordinates(
  name: string,
  version?: string,
): { name: string; version: string } | null {
  if (version) {
    return { name, version };
  }

  const parts = name.split('/');
  if (parts.length < 3) {
    return null;
  }

  const resolvedVersion = parts.pop();
  if (!resolvedVersion) {
    return null;
  }

  return { name: parts.join('/'), version: resolvedVersion };
}

export async function downloadHostedComposerArtifact(
  context: PluginContext,
  repo: Repository,
  name: string,
  version: string,
): Promise<ComposerDownloadResult> {
  const storageVersion = version.endsWith('.zip') ? version : `${version}.zip`;
  const storageKeyId = buildKey('composer', repo.id, name, storageVersion);

  try {
    let data = await context.storage.get(storageKeyId).catch(() => null);
    if (!data) {
      const storageKeyName = buildKey(
        'composer',
        repo.name,
        name,
        storageVersion,
      );
      data = await context.storage.get(storageKeyName).catch(() => null);
    }

    if (!data) {
      return { ok: false, message: 'Not found' };
    }

    return { ok: true, data, contentType: 'application/zip' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}

export function createComposerProxyMetadataDownloader(context: PluginContext) {
  const { proxyMetadata } = initMetadata(context);

  return (repo: Repository, name: string) => {
    return proxyMetadata(repo, name) as Promise<ComposerDownloadResult>;
  };
}

export function buildComposerProxyArtifactUrl(
  repo: Repository,
  name: string,
): string | null {
  const upstream = ((repo.config ?? {}) as ComposerConfig).proxyUrl;
  if (!upstream) {
    return null;
  }

  const cleanUpstream = upstream.endsWith('/')
    ? upstream.slice(0, -1)
    : upstream;
  return `${cleanUpstream}/${name}`;
}
