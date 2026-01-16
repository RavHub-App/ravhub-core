import { S3StorageAdapter } from '../s3-storage.adapter';
import * as fs from 'fs';
import * as path from 'path';

describe('S3StorageAdapter (emulate local)', () => {
  const tmp = path.join(process.cwd(), 'tmp-test-storage');
  beforeAll(() => {
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  });
  afterAll(() => {
    // cleanup
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {}
  });

  it('saves and streams a file', async () => {
    const cfg = { basePath: tmp };
    const s = new S3StorageAdapter(cfg as any);
    const key = 'foo/bar.txt';
    const data = Buffer.from('hello world');
    const res = await s.save(key, data);
    expect(res.ok).toBeTruthy();
    const exists = await s.exists(key);
    expect(exists).toBeTruthy();
    const url = await s.getUrl(key);
    expect(url.startsWith('file://')).toBeTruthy();
    const out = await s.getStream(key);
    expect(out.size).toBeGreaterThan(0);
    // read content
    const chunks: Buffer[] = [];
    for await (const c of out.stream) {
      chunks.push(Buffer.from(c));
    }
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello world');
  });

  it('supports ranged reads', async () => {
    const cfg = { basePath: tmp };
    const s = new S3StorageAdapter(cfg as any);
    const key = 'foo/range.txt';
    const data = Buffer.from('abcdefghijkl');
    await s.save(key, data);
    const out = await s.getStream(key, { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    for await (const c of out.stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString('utf8')).toBe('cdef');
    expect(out.size).toBe(data.length);
  });
});
