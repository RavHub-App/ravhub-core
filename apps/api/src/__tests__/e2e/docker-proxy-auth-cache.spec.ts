import { PluginManagerService } from '../../modules/plugins/plugin-manager.service';
import DockerPlugin from '../../modules/plugins/impl/docker-plugin';

describe('e2e: docker proxy auth + cache', () => {
  it('forwards Authorization and caches proxy fetch results', async () => {
    // simple in-memory storage like other tests
    const storage: any = {
      saved: new Map<string, Buffer | string>(),
      async save(k: string, d: Buffer | string) {
        this.saved.set(k, d);
      },
      async exists(k: string) {
        return this.saved.has(k);
      },
      async getUrl(k: string) {
        if (!this.saved.has(k)) throw new Error('not found');
        return `mem://${k}`;
      },
      async delete(k: string) {
        this.saved.delete(k);
      },
    };

    // initialize plugin storage
    await DockerPlugin.init?.({ storage });

    // create a tiny upstream mock that requires Basic auth and counts hits
    const http = require('http');
    const blob = Buffer.from('e2e-blob');
    const digest = `sha256:${require('crypto').createHash('sha256').update(blob).digest('hex')}`;

    let hits = 0;
    let lastAuth: string | undefined = undefined;

    const server = http.createServer((req: any, res: any) => {
      lastAuth = req.headers['authorization'];
      if (req.url && req.url.endsWith(`/blobs/${digest}`)) {
        hits++;
        // require auth
        if (!lastAuth) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="up"' });
          res.end('unauthorized');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(blob);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    // plugin manager with DockerPlugin available
    const pluginsSvc: any = {
      list: () => [{ key: 'docker' }],
      getInstance: () => DockerPlugin,
    };
    const monitor: any = { increment: jest.fn().mockResolvedValue(undefined) };
    const manager = new PluginManagerService(
      pluginsSvc,
      monitor,
      {} as any,
      {} as any,
      { isEnabled: () => false } as any,
      {} as any,
      {} as any,
    );

    const repo: any = {
      id: 'r-e2e-proxy',
      name: 'rp-e2e',
      manager: 'docker',
      type: 'proxy',
      config: {
        target: base,
        auth: { type: 'basic', username: 'u', password: 'p' },
        cacheTtlSeconds: 2,
      },
    };

    const url = `${base}/v2/upstream/repo/blobs/${encodeURIComponent(digest)}`;

    // first fetch -> should hit upstream and forward Authorization
    const first = await manager.proxyFetch(repo, url);
    expect(first?.ok).toBeTruthy();
    expect(first?.storageKey).toBeDefined();
    expect(hits).toBe(1);
    expect(lastAuth).toBeDefined();
    expect(lastAuth!.startsWith('Basic ')).toBeTruthy();

    // second fetch -> should be a cache hit, upstream should not be hit again
    const second = await manager.proxyFetch(repo, url);
    expect(second?.ok).toBeTruthy();
    expect(second?.storageKey).toBeDefined();
    expect(hits).toBe(1); // cached

    // wait past TTL and fetch again -> should hit upstream again
    await new Promise((r) => setTimeout(r, 2200));
    const third = await manager.proxyFetch(repo, url);
    expect(third?.ok).toBeTruthy();
    expect(hits).toBeGreaterThanOrEqual(2);

    server.close();
  });
});
