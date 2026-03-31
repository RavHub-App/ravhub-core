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

import { createReadStream } from 'node:fs';
import { promises as fs } from 'node:fs';
import type { IncomingHttpHeaders } from 'node:http';
import type { Writable } from 'node:stream';
import type { Repository } from '../utils/types';

type BlobRequest = {
  method?: string;
  headers: IncomingHttpHeaders;
};

type BlobResponse = Writable & {
  statusCode: number;
  setHeader: (name: string, value: string | number | readonly string[]) => void;
  end: (chunk?: string | Buffer) => void;
};

type BlobReadResult = {
  ok?: boolean;
  url?: string;
  data?: Buffer | string | Record<string, unknown>;
  body?: Buffer | string | Record<string, unknown>;
};

type BlobPlugin = {
  getBlob?: (
    repo: Repository,
    name: string,
    digest: string,
  ) => Promise<BlobReadResult | undefined>;
};

type BlobContext = {
  repo: Repository;
  opts?: { reposById?: Map<string, Repository> };
  plugin: BlobPlugin;
  req: BlobRequest;
  res: BlobResponse;
  pathname: string;
  debug: (label: string, ...args: unknown[]) => void;
  chosenVersion: 'v2';
};

function toBuffer(value: BlobReadResult['data']): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value);
  }
  return Buffer.from(JSON.stringify(value));
}

export async function handleBlobRoute(context: unknown): Promise<boolean> {
  const blobContext = context as BlobContext;
  const { repo, opts, plugin, req, res, pathname, debug, chosenVersion } =
    blobContext;
  const match =
    chosenVersion === 'v2'
      ? pathname.match(/^\/v2\/(.+)\/blobs\/([^/?]+)$/)
      : null;
  if (!((req.method === 'GET' || req.method === 'HEAD') && match)) {
    return false;
  }

  const name = decodeURIComponent(match[1]);
  const digest = decodeURIComponent(match[2]);
  let out: BlobReadResult | undefined;

  if (repo.type === 'group') {
    const members: string[] = repo.config?.members ?? [];
    debug(`[REGISTRY GROUP] blob GET for group ${repo.name}, digest=${digest}`);
    for (const memberId of members) {
      const childRepo = opts?.reposById?.get(memberId);
      if (!childRepo) {
        continue;
      }
      const childOut: BlobReadResult | undefined = await plugin.getBlob?.(
        childRepo,
        name,
        digest,
      );
      if (childOut?.ok) {
        debug(`[REGISTRY GROUP] blob resolved from member ${childRepo.name}`);
        out = childOut;
        break;
      }
    }
  } else {
    out = await plugin.getBlob?.(repo, name, digest);
  }

  if (!out?.ok) {
    console.warn(
      `[DOCKER_REGISTRY] Resource not found: ${name} (digest: ${digest}). Result:`,
      out,
    );
    res.statusCode = 404;
    res.end(JSON.stringify(out || { ok: false }));
    return true;
  }

  if ((out.url && out.url.startsWith('file://')) || out.data || out.body) {
    try {
      let buffer: Buffer | null = null;
      let size = 0;

      if (out.data || out.body) {
        buffer = toBuffer(out.data || out.body);
        size = buffer.length;
      } else {
        const fileUrl = out.url;
        if (!fileUrl) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: 'missing blob url' }));
          return true;
        }
        const filePath = fileUrl.replace(/^file:\/\//, '');
        const stat = await fs.stat(filePath);
        size = stat.size;
      }

      if (req.method === 'HEAD') {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Length', String(size));
        res.setHeader('Docker-Content-Digest', digest);
        res.statusCode = 200;
        res.end();
        return true;
      }

      const rangeHeader = req.headers.range;
      if (
        typeof rangeHeader === 'string' &&
        /^bytes=\d*-?\d*$/.test(rangeHeader) &&
        !buffer
      ) {
        const fileUrl = out.url;
        if (!fileUrl) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: 'missing blob url' }));
          return true;
        }
        const filePath = fileUrl.replace(/^file:\/\//, '');
        const parts = rangeHeader.replace(/bytes=/, '').split('-');
        const start = parts[0] ? parseInt(parts[0], 10) : 0;
        const end = parts[1] ? parseInt(parts[1], 10) : size - 1;
        const chunkLength = end - start + 1;
        const stream = createReadStream(filePath, { start, end });
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(chunkLength));
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Docker-Content-Digest', digest);
        res.statusCode = 206;
        stream.pipe(res);
        return true;
      }

      if (!buffer) {
        const fileUrl = out.url;
        if (!fileUrl) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, message: 'missing blob url' }));
          return true;
        }
        const filePath = fileUrl.replace(/^file:\/\//, '');
        buffer = await fs.readFile(filePath);
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', String(size));
      res.setHeader('Docker-Content-Digest', digest);
      res.statusCode = 200;
      res.end(buffer);
      return true;
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, message: String(error) }));
      return true;
    }
  }

  if (
    out.url &&
    out.url.startsWith('mem://') &&
    process.env.NODE_ENV === 'test'
  ) {
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/octet-stream');
      res.statusCode = 200;
      res.end();
      return true;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
    return true;
  }

  if (out.url) {
    res.statusCode = 302;
    res.setHeader('Location', out.url);
    res.end();
    return true;
  }

  res.statusCode = 200;
  res.end(JSON.stringify(out));
  return true;
}
