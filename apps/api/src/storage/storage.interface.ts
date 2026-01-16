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
  ): Promise<SaveResult & { contentHash?: string }>;
  // get a public (or internal) URL to read the object
  getUrl(key: string): Promise<string>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  // return a readable stream for the object optionally honoring a byte range
  getStream?(
    key: string,
    range?: { start?: number; end?: number },
  ): Promise<{
    stream: NodeJS.ReadableStream;
    size?: number;
    contentType?: string;
  }>;
  // get metadata (size, mtime, etc)
  getMetadata?(key: string): Promise<{ size: number; mtime: Date } | null>;
}
