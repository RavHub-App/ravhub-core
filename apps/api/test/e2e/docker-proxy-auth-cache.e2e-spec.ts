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

import { PluginManagerService } from '../../src/modules/plugins/plugin-manager.service';
import DockerPlugin from '../../src/modules/plugins/impl/docker-plugin';

describe('e2e: docker proxy auth + cache', () => {
  it('forwards Authorization and caches proxy fetch results', async () => {
    // simple in-memory storage with implicit 2s TTL for test
    const storage: any = {
      saved: new Map<string, { data: Buffer | string; time: number }>(),
      async save(k: string, d: Buffer | string) {
        this.saved.set(k, { data: d, time: Date.now() });
      },
      async get(k: string) {
        const entry = this.saved.get(k);
        if (!entry) return undefined;
        // Verify expiry (2s)
        if (Date.now() - entry.time > 2000) {
          this.saved.delete(k);
          return undefined;
        }
        return entry.data;
      },
      async exists(k: string) {
        const entry = this.saved.get(k);
        if (!entry) return false;
        if (Date.now() - entry.time > 2000) {
          this.saved.delete(k);
          return false;
        }
        return true;
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
    // Mock services
    const delegatorMock: any = {
      proxyFetch: (repo, url) => (DockerPlugin as any).proxyFetch(repo, url),
      getPluginForRepo: () => DockerPlugin,
    };

    const manager = new PluginManagerService(
      {} as any, // upstreamMock
      delegatorMock,
      {} as any, // jobMock
      {} as any, // cacheMock
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

    const url = `${base}/v2/upstream/repo/blobs/${digest}`;

    // first fetch -> should hit upstream and forward Authorization
    const first: any = await manager.proxyFetch(repo, url);
    expect(first?.ok).toBeTruthy();
    expect(first?.storageKey).toBeDefined();
    expect(hits).toBe(1);
    expect(lastAuth).toBeDefined();
    expect(lastAuth!.startsWith('Basic ')).toBeTruthy();

    // second fetch -> should be a cache hit, upstream should not be hit again
    const second: any = await manager.proxyFetch(repo, url);
    expect(second?.ok).toBeTruthy();
    expect(second?.storageKey).toBeDefined();
    expect(hits).toBe(1); // cached

    // wait past TTL and fetch again -> should hit upstream again
    await new Promise((r) => setTimeout(r, 2200));
    const third: any = await manager.proxyFetch(repo, url);
    expect(third?.ok).toBeTruthy();
    expect(hits).toBeGreaterThanOrEqual(2);

    server.close();
  });
});
