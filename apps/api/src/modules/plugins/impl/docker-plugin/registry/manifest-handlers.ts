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

import type { IncomingHttpHeaders } from 'node:http';
import { readBody } from './utils';
import {
  resolveManifestOrBlob,
  respondManifestHead,
  respondManifestRead,
  trackManifestDownload,
} from './manifest-read-support';
import { ensurePushAccess, respondProxyWriteRejected } from './upload-support';
import type { Repository } from '../utils/types';

type ManifestRequest = {
  method?: string;
  headers: IncomingHttpHeaders;
};

type ManifestResponse = {
  statusCode: number;
  setHeader: (name: string, value: string | number | readonly string[]) => void;
  end: (chunk?: string | Buffer) => void;
};

type ManifestReadResult = {
  ok?: boolean;
  versions?: string[];
  url?: string;
  data?: Buffer | string;
  body?: Buffer | string;
  metadata?: {
    digest?: string;
    groupId?: string;
    writePolicy?: string;
    targetRepoId?: string;
  };
};

type ManifestPlugin = {
  listVersions?: (
    repo: Repository,
    name: string,
  ) => Promise<ManifestReadResult | undefined>;
  putManifest?: (
    repo: Repository,
    name: string,
    tag: string,
    manifest: unknown,
  ) => Promise<ManifestReadResult | undefined>;
  getBlob?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<ManifestReadResult | undefined>;
  download?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<ManifestReadResult | undefined>;
  trackDownload?: (
    repo: Repository,
    name: string,
    tag: string,
  ) => Promise<void>;
};

type ManifestContext = {
  repo: Repository;
  opts?: { reposById?: Map<string, Repository> };
  plugin: ManifestPlugin;
  req: ManifestRequest;
  res: ManifestResponse;
  pathname: string;
  debug: (label: string, ...args: unknown[]) => void;
  chosenVersion: 'v2';
};

export async function handleTagsListRoute(context: unknown): Promise<boolean> {
  const manifestContext = context as ManifestContext;
  const { plugin, req, res, pathname, chosenVersion } = manifestContext;
  const match =
    chosenVersion === 'v2' ? pathname.match(/^\/v2\/(.+)\/tags\/list$/) : null;
  if (!((req.method === 'GET' || req.method === 'HEAD') && match)) return false;

  const name = decodeURIComponent(match[1]);
  const out = await plugin.listVersions?.(manifestContext.repo, name);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ name, tags: out?.versions ?? [] }));
  return true;
}

export async function handleManifestRoute(context: unknown): Promise<boolean> {
  const manifestContext = context as ManifestContext;
  const { repo, plugin, req, res, pathname, debug, chosenVersion } =
    manifestContext;
  const match =
    chosenVersion === 'v2'
      ? pathname.match(/^\/v2\/(.+)\/manifests\/([^/]+)$/)
      : null;
  if (!match) return false;

  if (req.method === 'PUT') {
    const name = decodeURIComponent(match[1]);
    if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
      respondProxyWriteRejected(res);
      return true;
    }
    if (!ensurePushAccess(req, res, repo, name, pathname)) {
      return true;
    }

    const tag = decodeURIComponent(match[2]);
    const data = await readBody(req);
    let manifest: unknown;
    try {
      manifest = JSON.parse(data.toString('utf8'));
    } catch {
      manifest = data.toString('utf8');
    }
    const out = await plugin.putManifest?.(repo, name, tag, manifest);
    if (out?.ok) {
      const manifestDigest = out?.metadata?.digest;
      if (manifestDigest) {
        res.setHeader('Docker-Content-Digest', manifestDigest);
      }
      if (out.metadata?.groupId) {
        res.setHeader('X-Group-Id', out.metadata.groupId);
      }
      if (out.metadata?.writePolicy) {
        res.setHeader('X-Write-Policy', out.metadata.writePolicy);
      }
      if (out.metadata?.targetRepoId) {
        res.setHeader('X-Write-Target', out.metadata.targetRepoId);
      }
      res.statusCode = 201;
      res.end(JSON.stringify(out));
    } else {
      res.statusCode = 400;
      res.end(JSON.stringify(out || { ok: false }));
    }
    return true;
  }

  if (!(req.method === 'GET' || req.method === 'HEAD')) return false;

  const name = decodeURIComponent(match[1]);
  const tag = decodeURIComponent(match[2]);
  debug(
    `[REGISTRY GET MANIFEST/BLOB] repo=${repo.name}, type=${repo.type}, name=${name}, tag=${tag}`,
  );
  const out: ManifestReadResult | undefined = await resolveManifestOrBlob(
    repo,
    manifestContext.opts?.reposById,
    plugin,
    debug,
    name,
    tag,
  );
  if (!out?.ok) {
    res.statusCode = 404;
    res.end(JSON.stringify(out || { ok: false }));
    return true;
  }

  await trackManifestDownload(plugin, repo, name, tag, debug);

  if (req.method === 'HEAD') {
    await respondManifestHead(res, out, name, tag);
    return true;
  }

  await respondManifestRead(res, out, name, tag, chosenVersion);
  return true;
}
