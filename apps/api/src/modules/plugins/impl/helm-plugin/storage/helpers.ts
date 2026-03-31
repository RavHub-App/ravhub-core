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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';

export type HelmRepository = {
  id: string;
  name?: string;
  type: string;
  config?: {
    members?: string[];
    writePolicy?: string;
    preferredWriter?: string;
    url?: string;
    cacheMaxAgeDays?: number;
  };
};

export type HelmPackage = {
  name?: string;
  version?: string;
  filename?: string;
  buffer?: Buffer | { type?: 'Buffer'; data?: number[] };
  content?: unknown;
  data?: unknown;
};

export type HelmStorageRequest = {
  body?: unknown;
  buffer?: unknown;
  [Symbol.asyncIterator]?: () => AsyncIterator<Buffer>;
};

const isBase64 = (value: string) =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(value.trim()) && value.trim().length % 4 === 0;

export const getBufferFromPackage = (pkg: HelmPackage): Buffer => {
  if (!pkg) {
    return Buffer.from([]);
  }

  if (Buffer.isBuffer(pkg.buffer)) {
    return pkg.buffer;
  }

  if (pkg.buffer?.type === 'Buffer' && Array.isArray(pkg.buffer.data)) {
    return Buffer.from(pkg.buffer.data);
  }

  const content = pkg.content ?? pkg.data;
  if (Buffer.isBuffer(content)) {
    return content;
  }

  if (typeof content === 'string') {
    if (isBase64(content)) {
      try {
        return Buffer.from(content, 'base64');
      } catch (error) {
        console.warn(
          `[HelmPlugin] Failed to decode package content as base64: ${String(error)}`,
        );
      }
    }

    return Buffer.from(content);
  }

  return Buffer.from(JSON.stringify(pkg));
};

export async function resolveHelmRepo(
  context: PluginContext,
  idOrName: string,
) {
  if (!idOrName || typeof context.getRepo !== 'function') {
    return null;
  }

  try {
    return await context.getRepo(idOrName);
  } catch (error) {
    console.warn(
      `[HelmPlugin] Failed to resolve repository ${idOrName}: ${String(error)}`,
    );
    return null;
  }
}

export async function readHelmRequestBuffer(
  req: HelmStorageRequest,
): Promise<Buffer> {
  if (req.body && Buffer.isBuffer(req.body)) {
    return req.body;
  }

  if (req.buffer && Buffer.isBuffer(req.buffer)) {
    return req.buffer;
  }

  if (req.body && typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body));
  }

  if (req.body) {
    return Buffer.from(String(req.body));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function inferChartIdentity(filePath: string) {
  return {
    name: filePath.replace(/-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/, ''),
    version:
      (filePath.match(/-([0-9]+\.[0-9]+\.[0-9]+)\.tgz$/) || [])[1] || '0.0.0',
    filename: filePath,
  };
}
