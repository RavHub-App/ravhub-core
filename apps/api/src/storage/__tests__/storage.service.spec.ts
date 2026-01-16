import { StorageService } from '../../modules/storage/storage.service';

// Mock RedlockService
const mockRedlock = {
  runWithLock: jest.fn((key, ttl, fn) => fn()),
} as any;

describe('StorageService (basic)', () => {
  let svc: StorageService;

  beforeAll(() => {
    svc = new StorageService(mockRedlock);
  });

  it('should not throw when datasource is not initialized and should resolve exists', async () => {
    await expect(svc.exists('some/non-existent/key')).resolves.toBe(false);
  });

  it('should save and stream a file via the default filesystem adapter', async () => {
    const key = 'tests/storage-service/test-file.txt';
    const data = 'hello-storage-service';
    const saveRes = await svc.save(key, data);
    expect(saveRes).toHaveProperty('ok', true);

    const streamRes = await svc.getStream(key);
    expect(streamRes).toHaveProperty('size');
    expect(streamRes.size).toBeGreaterThan(0);

    // consume stream
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      streamRes.stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      streamRes.stream.on('end', () => resolve());
      streamRes.stream.on('error', (err) => reject(err));
    });
    const out = Buffer.concat(chunks).toString('utf8');
    expect(out).toBe(data);
  });

  it('getStream should support ranged reads via service passthrough', async () => {
    const key = 'tests/storage-service/test-range.txt';
    const data = 'abcdefghijklmnopqrstuvwxyz';
    await svc.save(key, data);
    const out = await svc.getStream(key, { start: 2, end: 5 });
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      out.stream.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
      out.stream.on('end', () => resolve());
      out.stream.on('error', (err) => reject(err));
    });
    const outStr = Buffer.concat(chunks).toString('utf8');
    expect(outStr).toBe('cdef');
  });
});
