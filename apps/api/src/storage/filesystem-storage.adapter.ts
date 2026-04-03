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

import { StorageAdapter, SaveResult } from './storage.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { once } from 'events';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function waitForWritableEvent(
  stream: fs.WriteStream,
  event: 'drain' | 'finish',
  errorPromise: Promise<never>,
) {
  await Promise.race([
    once(stream, event),
    errorPromise,
  ]);
}

export class FilesystemStorageAdapter implements StorageAdapter {
  private base: string;

  constructor(basePath?: string) {
    this.base =
      basePath ||
      process.env.STORAGE_PATH ||
      path.resolve(process.cwd(), 'data', 'storage');
    // In test environment, enforce the environment variable to ensure isolation
    // providing a fail-safe against any hardcoded DB config leaks.
    const envPath = process.env.STORAGE_PATH;
    if (process.env.NODE_ENV === 'test' && envPath) {
      this.base = envPath;
    }

    fs.mkdirSync(this.base, { recursive: true });
  }

  private knownDirs = new Set<string>();

  async save(key: string, data: Buffer | string): Promise<SaveResult> {
    try {
      const dest = path.join(this.base, key);
      const dir = path.dirname(dest);
      if (!this.knownDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.knownDirs.add(dir);
      }
      if (Buffer.isBuffer(data)) {
        fs.writeFileSync(dest, data);
      } else if (typeof data === 'string') {
        // if string is a path to a file we can copy
        if (fs.existsSync(data)) fs.copyFileSync(data, dest);
        else fs.writeFileSync(dest, data);
      }
      return { ok: true, path: dest };
    } catch (error) {
      return { ok: false, message: getErrorMessage(error) };
    }
  }

  async saveStream(
    key: string,
    stream: NodeJS.ReadableStream,
  ): Promise<SaveResult & { contentHash?: string; size?: number }> {
    let writeStream: fs.WriteStream | null = null;
    let dest = '';

    try {
      dest = path.join(this.base, key);
      const dir = path.dirname(dest);
      if (!this.knownDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.knownDirs.add(dir);
      }

      const hash = crypto.createHash('sha256');
      let size = 0;
      writeStream = fs.createWriteStream(dest);
      const writeStreamError = new Promise<never>((_, reject) => {
        writeStream!.once('error', reject);
      });
      writeStreamError.catch(() => undefined);

      for await (const chunk of stream as AsyncIterable<Buffer | string>) {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(chunkBuffer);
        size += chunkBuffer.length;

        if (!writeStream.write(chunkBuffer)) {
          await waitForWritableEvent(writeStream, 'drain', writeStreamError);
        }
      }

      writeStream.end();
      await waitForWritableEvent(writeStream, 'finish', writeStreamError);

      return { ok: true, path: dest, contentHash: hash.digest('hex'), size };
    } catch (error) {
      if (writeStream && !writeStream.destroyed) {
        writeStream.destroy();
      }

      if (dest && fs.existsSync(dest)) {
        fs.rmSync(dest, { force: true });
      }

      return { ok: false, message: getErrorMessage(error) };
    }
  }

  async getUrl(key: string): Promise<string> {
    // For local filesystem we'll return a file:// url — in production this probably should be proxied
    const dest = path.join(this.base, key);
    return `file://${dest}`;
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = path.join(this.base, key);
    return fs.existsSync(fullPath);
  }

  async getStream(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{
    stream: any;
    size?: number;
    contentType?: string;
  } | null> {
    const dest = path.join(this.base, key);
    if (!fs.existsSync(dest)) return null;
    const stat = fs.statSync(dest);
    const size = stat.size;
    let start = 0;
    let end = size - 1;
    if (range) {
      if (typeof range.start === 'number') start = Math.max(0, range.start);
      if (typeof range.end === 'number') end = Math.min(size - 1, range.end);
    }
    const stream = fs.createReadStream(dest, { start, end });
    return { stream, size, contentType: 'application/octet-stream' };
  }

  async get(key: string): Promise<Buffer | null> {
    const fullPath = path.join(this.base, key);
    try {
      if (!fs.existsSync(fullPath)) return null;
      return fs.readFileSync(fullPath);
    } catch (_error) {
      void _error;
      return null;
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const dest = path.join(this.base, prefix);
      if (!fs.existsSync(dest)) return [];

      const results: string[] = [];
      const walk = (dir: string, basePrefix: string) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = path.join(basePrefix, entry.name);

          if (entry.isDirectory()) {
            walk(fullPath, relativePath);
          } else {
            results.push(relativePath);
          }
        }
      };

      walk(dest, prefix);
      return results;
    } catch (_error) {
      void _error;
      return [];
    }
  }

  async getMetadata(
    key: string,
  ): Promise<{ size: number; mtime: Date } | null> {
    try {
      const dest = path.join(this.base, key);
      if (!fs.existsSync(dest)) return null;
      const stat = fs.statSync(dest);
      return { size: stat.size, mtime: stat.mtime };
    } catch (_error) {
      void _error;
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const dest = path.join(this.base, key);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      return true;
    } catch (_error) {
      void _error;
      return false;
    }
  }
}
