/*
 * Copyright (C) 2026 RavHub Team
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

export interface SaveResult {
  ok: boolean;
  path?: string;
  message?: string;
}

export interface StorageAdapter {
  // store binary data under key and return a path/identifier
  save(key: string, data: Buffer | string): Promise<SaveResult>;
  // store binary data from a stream under key
  saveStream?(
    key: string,
    stream: NodeJS.ReadableStream,
  ): Promise<SaveResult & { contentHash?: string; size?: number }>;
  // get a public (or internal) URL to read the object
  getUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  // return a readable stream for the object optionally honoring a byte range
  getStream?(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{
    stream: any; // NodeJS.ReadableStream or ReadableStream
    size?: number;
    length?: number;
    contentType?: string;
  } | null>;
  // get metadata (size, mtime, etc)
  getMetadata?(key: string): Promise<{ size: number; mtime: Date } | null>;
  // optionally get raw buffer
  get?(key: string): Promise<Buffer | null>;
  // optionally list keys by prefix
  list?(prefix: string): Promise<string[]>;
}
