import { readBody } from './utils';
import { parseLegacyUploadBuffer } from './upload-support';
import type { Repository } from '../utils/types';

type UploadRequest = {
  method?: string;
};

export function matchUploadInitiationPath(
  pathname: string,
  chosenVersion: 'v2',
) {
  return chosenVersion === 'v2'
    ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads\/?$/)
    : null;
}

export function matchUploadAppendPath(pathname: string, chosenVersion: 'v2') {
  return chosenVersion === 'v2'
    ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads\/([^/]+)$/)
    : null;
}

export function matchUploadFinalizePath(pathname: string, chosenVersion: 'v2') {
  return chosenVersion === 'v2'
    ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads(?:\/([^/]+))?$/)
    : null;
}

export function matchSingleStepUploadPath(pathname: string | undefined) {
  return pathname?.includes('/blobs/uploads/')
    ? null
    : pathname?.match(/^\/v2\/(.+)\/blobs\/uploads\/?$/);
}

export function isWritableUploadMethod(req: UploadRequest) {
  return req.method === 'POST' || req.method === 'PATCH';
}

export function isProxyRepository(repo: Repository) {
  return (repo?.type || '').toString().toLowerCase() === 'proxy';
}

export function resolveUploadDigest(
  digestValue: string | string[] | undefined,
) {
  return Array.isArray(digestValue) ? digestValue[0] : digestValue;
}

export async function resolveUploadBuffer(
  req: unknown,
  repo: Repository,
  name: string,
) {
  const data = await readBody(req);
  return parseLegacyUploadBuffer(repo.name || repo.id || 'unknown', name, data);
}

export async function resolveFinalizeUploadBuffer(
  req: unknown,
  repo: Repository,
  name: string,
) {
  const data = await readBody(req);
  const rawBuffer = data && data.length ? data : undefined;
  return parseLegacyUploadBuffer(
    repo.name || repo.id || 'unknown',
    name,
    rawBuffer,
  );
}
