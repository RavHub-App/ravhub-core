import { StorageAdapter, SaveResult } from './storage.interface';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { pipeline } from 'stream/promises';

export class FilesystemStorageAdapter implements StorageAdapter {
  private base: string;

  constructor(basePath?: string) {
    this.base =
      basePath ||
      process.env.STORAGE_PATH ||
      path.resolve(process.cwd(), 'data', 'storage');
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
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async saveStream(
    key: string,
    stream: NodeJS.ReadableStream,
  ): Promise<SaveResult & { contentHash?: string; size?: number }> {
    try {
      const dest = path.join(this.base, key);
      const dir = path.dirname(dest);
      if (!this.knownDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.knownDirs.add(dir);
      }

      const hash = crypto.createHash('sha256');
      let size = 0;
      const writeStream = fs.createWriteStream(dest);

      // We use a PassThrough to split the stream to both hash and file
      const { PassThrough } = require('stream');
      const pass = new PassThrough();

      pass.on('data', (chunk) => {
        hash.update(chunk);
        size += chunk.length;
      });

      await pipeline(stream as any, pass, writeStream);

      return { ok: true, path: dest, contentHash: hash.digest('hex'), size };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  }

  async getUrl(key: string): Promise<string> {
    // For local filesystem we'll return a file:// url — in production this probably should be proxied
    const dest = path.join(this.base, key);
    return `file://${dest}`;
  }

  async exists(key: string): Promise<boolean> {
    const dest = path.join(this.base, key);
    return fs.existsSync(dest);
  }

  async getStream(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size?: number;
    contentType?: string;
  }> {
    const dest = path.join(this.base, key);
    if (!fs.existsSync(dest)) throw new Error('not found');
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
    try {
      const dest = path.join(this.base, key);
      if (!fs.existsSync(dest)) return null;
      return fs.readFileSync(dest);
    } catch (err) {
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
    } catch (err) {
      return [];
    }
  }

  async getMetadata(key: string): Promise<{ size: number; mtime: Date } | null> {
    try {
      const dest = path.join(this.base, key);
      if (!fs.existsSync(dest)) return null;
      const stat = fs.statSync(dest);
      return { size: stat.size, mtime: stat.mtime };
    } catch (err) {
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const dest = path.join(this.base, key);
      if (fs.existsSync(dest)) fs.unlinkSync(dest);
      return true;
    } catch (err) {
      return false;
    }
  }
}
