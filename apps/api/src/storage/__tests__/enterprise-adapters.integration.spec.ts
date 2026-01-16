import * as fs from 'fs';
import * as path from 'path';

import { S3StorageAdapter } from '../s3-storage.adapter';
import { GcsEnterpriseAdapter } from '../adapters/gcs-enterprise.adapter';
import { AzureEnterpriseAdapter } from '../adapters/azure-enterprise.adapter';

describe('Enterprise storage adapters (emulation mode)', () => {
  const tmp = path.join(process.cwd(), 'tmp-enterprise-test');
  beforeAll(() => {
    if (!fs.existsSync(tmp)) fs.mkdirSync(tmp, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (err) { }
  });

  const adapters = [
    { name: 's3', cls: S3StorageAdapter },
    { name: 'gcs', cls: GcsEnterpriseAdapter },
    { name: 'azure', cls: AzureEnterpriseAdapter },
  ];

  for (const a of adapters) {
    it(`${a.name} adapter should save, stream, range and delete`, async () => {
      const cfg = { basePath: tmp } as any;
      // eslint-disable-next-line new-cap
      const inst: any = new (a as any).cls(cfg);
      const key = `pkg/${a.name}/file.txt`;
      const data = Buffer.from('integration test content');

      const res = await inst.save(key, data);
      expect(res.ok).toBeTruthy();

      const exists = await inst.exists(key);
      expect(exists).toBeTruthy();

      const url = await inst.getUrl(key);
      expect(url.startsWith('file://')).toBeTruthy();

      const out = await inst.getStream(key);
      expect(out.size).toBeGreaterThan(0);

      const chunks: Buffer[] = [];
      for await (const c of out.stream) chunks.push(Buffer.from(c));
      expect(Buffer.concat(chunks).toString('utf8')).toBe(
        'integration test content',
      );

      // ranged read
      // 'integration test content' -> 'content' starts at byte 17
      const ranged = await inst.getStream(key, { start: 17, end: 23 });
      const rc: Buffer[] = [];
      for await (const c of ranged.stream) rc.push(Buffer.from(c));
      expect(Buffer.concat(rc).toString('utf8')).toBe('content');

      const deleted = await inst.delete(key);
      expect(deleted).toBeTruthy();
    });
  }
});
