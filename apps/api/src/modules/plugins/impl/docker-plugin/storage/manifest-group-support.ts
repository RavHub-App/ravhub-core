import type { Repository } from '../utils/types';

type PutManifestResult = {
  ok: boolean;
  message?: string;
  metadata?: Record<string, unknown>;
};

export function resolveManifestGroupWritePolicy(repo: Repository) {
  return (
    ((repo?.config || {}) as any).writePolicy?.toString().toLowerCase() ||
    'none'
  );
}

export function getManifestGroupMembers(repo: Repository) {
  return Array.isArray((repo?.config || {})?.members)
    ? (((repo?.config || {}) as any).members as string[])
    : [];
}

export async function resolvePreferredHostedManifestRepo(
  repo: Repository,
  members: string[],
  writePolicy: string,
  getRepo: ((id: string) => Promise<Repository | null>) | null,
) {
  const preferredWriter = ((repo.config || {}) as any).preferredWriter;
  if (!preferredWriter) {
    return {
      ok: false,
      message: `writePolicy=${writePolicy} requires preferredWriter`,
    } satisfies PutManifestResult;
  }

  if (!members.includes(preferredWriter)) {
    return {
      ok: false,
      message: 'preferredWriter not in members',
    } satisfies PutManifestResult;
  }

  const targetRepo = await getRepo?.(preferredWriter);
  if (!targetRepo) {
    return {
      ok: false,
      message: `preferredWriter ${preferredWriter} not found`,
    } satisfies PutManifestResult;
  }

  if (!isHostedRepo(targetRepo)) {
    return {
      ok: false,
      message: `preferredWriter ${preferredWriter} is not hosted`,
    } satisfies PutManifestResult;
  }

  return { ok: true, targetRepo } as const;
}

export async function getHostedManifestMembers(
  members: string[],
  getRepo: ((id: string) => Promise<Repository | null>) | null,
) {
  const hosted: Repository[] = [];
  for (const id of members) {
    const member = await getRepo?.(id);
    if (isHostedRepo(member)) {
      hosted.push(member);
    }
  }
  return hosted;
}

export function buildGroupManifestSuccess(
  result: PutManifestResult,
  repo: Repository,
  metadata: Record<string, unknown>,
) {
  return {
    ...result,
    metadata: {
      ...result.metadata,
      groupId: repo.id,
      ...metadata,
    },
  };
}

export function isHostedRepo(
  repo: Repository | null | undefined,
): repo is Repository {
  return Boolean(
    repo && (repo.type || '').toString().toLowerCase() === 'hosted',
  );
}
