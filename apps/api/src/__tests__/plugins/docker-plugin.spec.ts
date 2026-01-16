import DockerPlugin from '../../modules/plugins/impl/docker-plugin';

describe('DockerPlugin (unit)', () => {
  // Tests run in CI may not have ports 5000..5100 available, override the
  // registry port search range for unit tests so in-process registries can
  // bind on ephemeral high ports without conflicting with Docker compose dev
  // environment. The real runtime still uses 5000..5100 by default.
  process.env.REGISTRY_PORT_START = process.env.REGISTRY_PORT_START || '30000';
  process.env.REGISTRY_PORT_END = process.env.REGISTRY_PORT_END || '30100';
  const storage = {
    saved: new Map<string, Buffer | string>(),
    async save(key: string, data: Buffer | string) {
      this.saved.set(key, data);
    },
    async exists(key: string) {
      return this.saved.has(key);
    },
    async delete(key: string) {
      this.saved.delete(key);
    },
    async getUrl(key: string) {
      if (!this.saved.has(key)) throw new Error('not found');
      return `mem://${key}`;
    },
  };

  const artifacts: any[] = [];
  const mockDS = {
    isInitialized: true,
    getRepository: (name: string) => ({
      async find(opts?: any) {
        return artifacts.filter(
          (a: any) => !opts || a.repositoryId === opts.where.repositoryId,
        );
      },
      create(obj: any) {
        return obj;
      },
      async save(obj: any) {
        artifacts.push(obj);
        return obj;
      },
    }),
  };

  beforeAll(async () => {
    await DockerPlugin.init?.({ storage, dataSource: mockDS });
  });

  it('should initiate/append/finalize upload and save blob', async () => {
    const repo = { id: 'r1' };
    const name = 'library/test';

    const { ok, uuid } = (await DockerPlugin.initiateUpload?.(
      repo as any,
      name,
    )) || { ok: false };
    expect(ok).toBeTruthy();
    expect(uuid).toBeDefined();

    const chunk1 = Buffer.from('hello-');
    const chunk2 = Buffer.from('world');

    const a1 = await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      chunk1,
    );
    expect(a1?.ok).toBeTruthy();
    expect(a1?.uploaded).toBe(chunk1.length);

    const a2 = await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      chunk2,
    );
    expect(a2?.ok).toBeTruthy();
    expect(a2?.uploaded).toBe(chunk1.length + chunk2.length);

    const fin = await DockerPlugin.finalizeUpload?.(
      repo as any,
      name,
      uuid as string,
    );
    expect(fin?.ok).toBeTruthy();
    expect(fin?.metadata?.storageKey).toBeDefined();

    const exists = await storage.exists(fin?.metadata?.storageKey as string);
    expect(exists).toBeTruthy();
  });

  it('should store manifest via putManifest and listVersions fallback', async () => {
    const repo = { id: 'r1' };
    const name = 'library/test';
    const tag = 'v1';

    // Create a blob first so putManifest can validate references
    const { ok: iuOk, uuid } = (await DockerPlugin.initiateUpload?.(
      repo as any,
      name,
    )) || { ok: false };
    expect(iuOk).toBeTruthy();
    await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      Buffer.from('hello-world'),
    );
    const fin = await DockerPlugin.finalizeUpload?.(
      repo as any,
      name,
      uuid as string,
    );
    expect(fin?.ok).toBeTruthy();
    const digest = fin?.id as string;

    const manifest = { schemaVersion: 2, config: { digest } };
    const out = await DockerPlugin.putManifest?.(
      repo as any,
      name,
      tag,
      manifest,
    );
    expect(out?.ok).toBeTruthy();
    expect(out?.metadata?.storageKey).toBeDefined();

    const dl = await DockerPlugin.download?.(repo as any, name, tag);
    expect(dl?.ok).toBeTruthy();

    const versions = await DockerPlugin.listVersions?.(repo as any, name);
    expect(versions?.ok).toBeTruthy();
  });

  it('should issue a token for credentials', async () => {
    const repo = { id: 'r1' };
    const cred = { username: 'u1' };
    const out = await DockerPlugin.issueToken?.(repo as any, cred);
    expect(out?.ok).toBeTruthy();
    expect(out?.token).toBeDefined();
  });

  it('should startRegistryForRepo and return port + accessUrl', async () => {
    const repo = { id: 'r-start', name: 'my-repo' };
    const out: any = await DockerPlugin.startRegistryForRepo?.(repo as any, {});
    expect(out?.ok).toBeTruthy();
    expect(typeof out?.port).toBe('number');
    expect(out?.port).toBeGreaterThan(0);
    expect(typeof out?.accessUrl).toBe('string');
    expect(out?.accessUrl).toMatch(/^https?:\/\//);

    // Verify the in-process registry responds to /v2/ ping
    const http = require('http');
    const pingRes = (await new Promise((resolve, reject) => {
      http.get(`${out.accessUrl}/v2/`, (r: any) => {
        const bufs: any[] = [];
        r.on('data', (d: any) => bufs.push(d));
        r.on('end', () =>
          resolve({
            status: r.statusCode,
            body: Buffer.concat(bufs).toString('utf8'),
          }),
        );
        r.on('error', reject);
      });
    })) as any;
    expect(pingRes.status).toBe(200);
    expect(pingRes.body).toMatch(/ok/);

    // Try initiating an upload via the registry endpoint _without_ Authorization -> expect 401 challenge
    const name = 'library/test';
    const reqResUnauth = (await new Promise((resolve, reject) => {
      const req = http.request(
        `${out.accessUrl}/v2/${encodeURIComponent(name)}/blobs/uploads`,
        { method: 'POST' },
        (r: any) => {
          const bufs: any[] = [];
          r.on('data', (d: any) => bufs.push(d));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              headers: r.headers,
              body: Buffer.concat(bufs).toString('utf8'),
            }),
          );
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    })) as any;
    expect(reqResUnauth.status).toBe(401);
    expect(reqResUnauth.headers['www-authenticate']).toBeDefined();

    // Try with x-user-roles header (admin) — should allow pushes for tests
    const reqResRoles = (await new Promise((resolve, reject) => {
      const options: any = {
        method: 'POST',
        headers: { 'x-user-roles': 'admin' },
      };
      const req = http.request(
        `${out.accessUrl}/v2/${encodeURIComponent(name)}/blobs/uploads`,
        options,
        (r: any) => {
          const bufs: any[] = [];
          r.on('data', (d: any) => bufs.push(d));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              headers: r.headers,
              body: Buffer.concat(bufs).toString('utf8'),
            }),
          );
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    })) as any;
    expect([200, 201, 202]).toContain(reqResRoles.status);

    // Now generate a JWT with proper access and retry
    const jwt = require('jsonwebtoken');
    const secret =
      process.env.JWT_SECRET || 'test-secret-do-not-use-in-production';
    const tok = jwt.sign(
      { access: [{ type: 'repository', name: name, actions: ['push'] }] },
      secret,
    );
    const reqResAuth = (await new Promise((resolve, reject) => {
      const options: any = {
        method: 'POST',
        headers: { Authorization: `Bearer ${tok}` },
      };
      const req = http.request(
        `${out.accessUrl}/v2/${encodeURIComponent(name)}/blobs/uploads`,
        options,
        (r: any) => {
          const bufs: any[] = [];
          r.on('data', (d: any) => bufs.push(d));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              headers: r.headers,
              body: Buffer.concat(bufs).toString('utf8'),
            }),
          );
          r.on('error', reject);
        },
      );
      req.on('error', reject);
      req.end();
    })) as any;
    expect([200, 201, 202]).toContain(reqResAuth.status);
    expect(reqResAuth.headers.location || reqResAuth.body).toBeDefined();
  });

  it('should start v1 registry and respond to v1 ping and tags shape', async () => {
    const repo = {
      id: 'r-start-v1',
      name: 'repo-v1',
      config: { docker: { version: 'v1' } },
    };
    const out: any = await DockerPlugin.startRegistryForRepo?.(repo as any, {
      version: 'v1',
    });
    expect(out?.ok).toBeTruthy();
    expect(out?.version).toBe('v1');

    const http = require('http');
    const pingRes = (await new Promise((resolve, reject) => {
      http.get(`${out.accessUrl}/v1/_ping`, (r: any) => {
        const bufs: any[] = [];
        r.on('data', (d: any) => bufs.push(d));
        r.on('end', () =>
          resolve({
            status: r.statusCode,
            body: Buffer.concat(bufs).toString('utf8'),
          }),
        );
        r.on('error', reject);
      });
    })) as any;
    expect(pingRes.status).toBe(200);
    expect(pingRes.body).toMatch(/ok/);

    // tags endpoint v1 returns a map shape (object) — call tags
    const name = 'library/testv1';
    const tagsRes = (await new Promise((resolve, reject) => {
      http.get(
        `${out.accessUrl}/v1/repositories/${encodeURIComponent(name)}/tags`,
        (r: any) => {
          const bufs: any[] = [];
          r.on('data', (d: any) => bufs.push(d));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              body: Buffer.concat(bufs).toString('utf8'),
            }),
          );
          r.on('error', reject);
        },
      );
    })) as any;
    expect(tagsRes.status).toBe(200);
    expect(() => JSON.parse(tagsRes.body)).not.toThrow();
  });

  it('should verify digest checking and HEAD on blobs', async () => {
    const repo = { id: 'r-digest', name: 'digest-repo' };
    const name = 'library/digest-test';

    // create a multipart upload and finalize with computed digest
    const { ok, uuid } = (await DockerPlugin.initiateUpload?.(
      repo as any,
      name,
    )) || { ok: false };
    expect(ok).toBeTruthy();
    expect(uuid).toBeDefined();

    await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      Buffer.from('hello-'),
    );
    await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      Buffer.from('world'),
    );

    const crypto = require('crypto');
    const digest = `sha256:${crypto.createHash('sha256').update('hello-world').digest('hex')}`;

    const fin = await DockerPlugin.finalizeUpload?.(
      repo as any,
      name,
      uuid as string,
      digest,
    );
    expect(fin?.ok).toBeTruthy();
    expect(fin?.id).toBe(digest);

    // ensure HEAD to the blob endpoint returns 200 via an in-process registry
    const out: any = await DockerPlugin.startRegistryForRepo?.(repo as any, {});
    expect(out?.ok).toBeTruthy();

    const http = require('http');
    const headRes = (await new Promise((resolve, reject) => {
      const req = http.request(
        `${out.accessUrl}/v2/${encodeURIComponent(name)}/blobs/${encodeURIComponent(digest)}`,
        { method: 'HEAD' },
        (r: any) => {
          resolve({ status: r.statusCode, headers: r.headers });
        },
      );
      req.on('error', reject);
      req.end();
    })) as any;
    expect(headRes.status).toBe(200);

    // try a bad digest finalization
    const uuid2 = (await DockerPlugin.initiateUpload?.(repo as any, name))
      ?.uuid;
    await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid2 as string,
      Buffer.from('x'),
    );
    const bad = await DockerPlugin.finalizeUpload?.(
      repo as any,
      name,
      uuid2 as string,
      'sha256:deadbeef',
    );
    expect(bad?.ok).toBeFalsy();
  });

  it('should fetch missing blobs from upstream for proxy repos when putting manifest', async () => {
    // spin up a tiny HTTP server to act as upstream registry serving blob content
    const http = require('http');
    const blobContent = Buffer.from('upstream-blob');
    const digest = `sha256:${require('crypto').createHash('sha256').update(blobContent).digest('hex')}`;
    const name = 'upstream/repo';

    const server = http.createServer((req: any, res: any) => {
      if (req.url && req.url.endsWith(`/blobs/${digest}`)) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(blobContent);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const repo = {
      id: 'r-proxy',
      name: 'rp',
      type: 'proxy',
      config: { target: base },
    };
    const manifest = {
      schemaVersion: 2,
      config: { digest },
      layers: [{ digest }],
    };

    const out = await DockerPlugin.putManifest?.(
      repo as any,
      name,
      'v1',
      manifest,
    );
    expect(out?.ok).toBeTruthy();
    // after putManifest, storage should have the blob and the manifest
    const storageKey = out?.metadata?.storageKey;
    expect(storageKey).toBeDefined();

    // cleanup
    server.close();
  });

  it('should forward configured Authorization to upstream when proxyFetch called', async () => {
    const http = require('http');
    const blobContent = Buffer.from('auth-blob');
    const digest = `sha256:${require('crypto').createHash('sha256').update(blobContent).digest('hex')}`;
    let receivedAuth: string | undefined = undefined;

    const server = http.createServer((req: any, res: any) => {
      receivedAuth = req.headers['authorization'];
      if (req.url && req.url.endsWith(`/blobs/${digest}`)) {
        if (!receivedAuth) {
          res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="up"' });
          res.end('unauthorized');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(blobContent);
        return;
      }
      res.writeHead(404);
      res.end('not found');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}`;

    const repo = {
      id: 'r-proxy-auth',
      name: 'rp-auth',
      type: 'proxy',
      config: {
        target: base,
        auth: { type: 'basic', username: 'u', password: 'p' },
      },
    };

    const url = `${base}/v2/upstream/repo/blobs/${digest}`;
    const out = await DockerPlugin.proxyFetch?.(repo as any, url);
    expect(out?.ok).toBeTruthy();
    expect(out?.storageKey).toBeDefined();

    // ensure server received Authorization header and it looks like Basic
    expect(receivedAuth).toBeDefined();
    expect(receivedAuth!.startsWith('Basic ')).toBeTruthy();

    // saved blob exists in memory storage
    const exists = await (DockerPlugin as any).storage.exists(
      out?.storageKey as string,
    );
    expect(exists).toBeTruthy();

    server.close();
  });

  it('in-process registry for proxy should reject pushes (PUT manifest)', async () => {
    const repo = {
      id: 'r-reg-proxy',
      name: 'repo-reg-proxy',
      type: 'proxy',
    } as any;
    const out: any = await DockerPlugin.startRegistryForRepo?.(repo, {});
    expect(out?.ok).toBeTruthy();

    const http = require('http');
    const manifest = JSON.stringify({
      schemaVersion: 2,
      config: { digest: 'sha256:abc' },
    });

    const res = (await new Promise((resolve) => {
      const req = http.request(
        `${out.accessUrl}/v2/library/test/manifests/latest`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' } },
        (r: any) => {
          const bufs: any[] = [];
          r.on('data', (d: any) => bufs.push(d));
          r.on('end', () =>
            resolve({
              status: r.statusCode,
              body: Buffer.concat(bufs).toString('utf8'),
            }),
          );
        },
      );
      req.on('error', (e: any) => resolve({ status: 0, error: String(e) }));
      req.write(manifest);
      req.end();
    })) as any;

    // proxy registry should reject a push (405)
    expect([403, 405]).toContain(res.status);
  });

  it('should stop in-process registry via stopRegistryForRepo', async () => {
    const repo = { id: 'r-stop', name: 'repo-stop' };
    const out: any = await DockerPlugin.startRegistryForRepo?.(repo as any, {});
    expect(out?.ok).toBeTruthy();

    const stopped = await DockerPlugin.stopRegistryForRepo?.(repo as any);
    expect(stopped?.ok).toBeTruthy();

    // requests should now fail to connect
    const http = require('http');
    const res = (await new Promise((resolve) => {
      const req = http.get(`${out.accessUrl}/v2/`, (r: any) => {
        resolve({ ok: true, status: r.statusCode });
      });
      req.on('error', (e: any) => resolve({ ok: false, error: String(e) }));
    })) as any;
    expect(res.ok).toBeFalsy();
  });

  it('should delete manifest when requested', async () => {
    const repo = { id: 'r-del', name: 'repo-del' };
    const name = 'library/del';
    const tag = 'vdelete';
    // ensure blob exists before putting manifest
    const { ok: iuOk, uuid } = (await DockerPlugin.initiateUpload?.(
      repo as any,
      name,
    )) || { ok: false };
    expect(iuOk).toBeTruthy();
    await DockerPlugin.appendUpload?.(
      repo as any,
      name,
      uuid as string,
      Buffer.from('delete-me'),
    );
    const fin = await DockerPlugin.finalizeUpload?.(
      repo as any,
      name,
      uuid as string,
    );
    expect(fin?.ok).toBeTruthy();
    const manifest = { schemaVersion: 2, config: { digest: fin?.id } };

    const put = await DockerPlugin.putManifest?.(
      repo as any,
      name,
      tag,
      manifest,
    );
    expect(put?.ok).toBeTruthy();
    const key = put?.metadata?.storageKey;
    expect(key).toBeDefined();

    const del = await DockerPlugin.deleteManifest?.(repo as any, name, tag);
    expect(del?.ok).toBeTruthy();

    const exists = await (DockerPlugin as any).storage.exists(key);
    // storage in unit test plugin points to our mock storage; we check it does not exist
    expect(exists).toBeFalsy();
  });
});
