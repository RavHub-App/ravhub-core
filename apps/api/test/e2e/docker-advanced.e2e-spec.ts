/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import request from 'supertest';
import { setupTestApp, cleanupTestApp, TestContext } from './test-helpers';
import * as crypto from 'crypto';
import * as http from 'http';

describe('Docker Advanced E2E (Proxy, Cache, Auth, Group)', () => {
    let context: TestContext;
    let authToken: string;
    let mockRegistry: http.Server;
    let mockRegistryPort: number;

    // Mock upstream state
    let upstreamManifests: Record<string, any> = {};
    let upstreamBlobs: Record<string, Buffer> = {};
    let upstreamHits = 0;
    let lastRequestHeaders: any = {};

    beforeAll(async () => {
        process.env.REGISTRY_PORT_START = '8200';
        process.env.REGISTRY_PORT_END = '8300';
        process.env.JWT_SECRET = 'test-secret';
        process.env.DEBUG_REGISTRY = 'true';
        process.env.DEBUG_DOCKER_PLUGIN = 'true';
        context = await setupTestApp({ useRealPlugins: true });

        await context.app.listen(0);
        const address = (context.app.getHttpServer() as any).address();
        process.env.API_URL = `http://localhost:${address.port}`;

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;

        // Start Mock Upstream Registry
        mockRegistry = http.createServer((req, res) => {
            upstreamHits++;
            lastRequestHeaders = req.headers;
            const url = req.url || '';

            // Handle ping/version
            if (url === '/v2/') {
                res.writeHead(200, { 'Docker-Distribution-API-Version': 'registry/2.0' });
                res.end('{}');
                return;
            }

            // Token endpoint for Docker Hub style auth
            if (url.includes('/v2/token')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({
                    token: 'mock-upstream-token',
                    expires_in: 3600
                }));
                return;
            }

            // Require auth if configured (we'll test both)
            const auth = req.headers.authorization;
            const needsAuth = url.includes('/needs-auth/');
            if (needsAuth && !auth) {
                res.writeHead(401, {
                    'WWW-Authenticate': `Bearer realm="http://localhost:${mockRegistryPort}/v2/token",service="mock-registry",scope="repository:test:pull"`
                });
                res.end(JSON.stringify({ errors: [{ code: 'UNAUTHORIZED' }] }));
                return;
            }


            // Manifests
            if (url.includes('/manifests/') && req.method === 'GET') {
                // Extract image name and reference
                const parts = url.split('/v2/')[1].split('/manifests/');
                const image = parts[0];
                let reference = parts[1];
                // Handle cases where reference might be like sha256:....
                if (reference.includes('sha256:') && !reference.startsWith('sha256:')) {
                    reference = 'sha256:' + reference.split('sha256:')[1];
                }
                const key = `${image}:${reference}`;

                const manifest = upstreamManifests[key] ||
                    upstreamManifests[reference] ||
                    (image.includes('/') ? upstreamManifests[image.split('/').pop()! + ':' + reference] : null);

                if (manifest) {
                    res.writeHead(200, {
                        'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json',
                        'Docker-Content-Digest': `sha256:${crypto.createHash('sha256').update(JSON.stringify(manifest)).digest('hex')}`
                    });
                    res.end(JSON.stringify(manifest));
                    return;
                }
            }

            // Blobs
            if (url.includes('/blobs/') && req.method === 'GET') {
                const blobDigest = url.split('/blobs/')[1];
                const content = upstreamBlobs[blobDigest];
                if (content) {
                    res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Docker-Content-Digest': blobDigest
                    });
                    res.end(content);
                    return;
                }
            }

            res.writeHead(404);
            res.end(JSON.stringify({ ok: false, message: 'not found upstream' }));
        });

        await new Promise<void>(r => mockRegistry.listen(0, 'localhost', () => r()));
        mockRegistryPort = (mockRegistry.address() as any).port;
    });

    afterAll(async () => {
        if (mockRegistry) mockRegistry.close();
        await cleanupTestApp(context.app);
    });

    describe('🔍 Docker Proxy & Cache', () => {
        let proxyRepoId: string;
        const proxyRepoName = `docker-proxy-${Date.now()}`;
        const imageName = 'remote-image';
        const tag = 'latest';
        let dockerToken: string;

        const blobContent = Buffer.from('remote-blob-content');
        const blobDigest = `sha256:${crypto.createHash('sha256').update(blobContent).digest('hex')}`;
        const manifest = {
            schemaVersion: 2,
            mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
            config: { mediaType: 'application/vnd.docker.container.image.v1+json', size: 2, digest: 'sha256:config' },
            layers: [{ mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip', size: blobContent.length, digest: blobDigest }]
        };

        beforeAll(async () => {
            upstreamManifests[`${imageName}:${tag}`] = manifest;
            upstreamBlobs[blobDigest] = blobContent;
        });

        it('should create a proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: proxyRepoName,
                    type: 'proxy',
                    manager: 'docker',
                    config: {
                        target: `http://localhost:${mockRegistryPort}`,
                        cacheEnabled: true
                    }
                })
                .expect(201);
            proxyRepoId = res.body.id;
            await new Promise(r => setTimeout(r, 1000));
        });

        it('should get a docker token for the proxy', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/token`)
                .set('Authorization', `Bearer ${authToken}`)
                .query({ scope: `repository:${imageName}:pull` })
                .expect(200);
            dockerToken = res.body.token;
        });

        it('should pull manifest from proxy', async () => {
            upstreamHits = 0;
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/${imageName}/manifests/${tag}`)
                .set('Authorization', `Bearer ${dockerToken}`);

            if (res.status !== 200) {
                console.error('Pull manifest failed:', res.status, res.body);
            }
            expect(res.status).toBe(200);
            expect(res.body.schemaVersion).toBe(2);
            expect(upstreamHits).toBeGreaterThanOrEqual(1);
        });

        it('should allow RavHub Admin to pull manifest without Docker token', async () => {
            upstreamHits = 0;
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/${imageName}/manifests/${tag}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            if (Buffer.isBuffer(res.body)) {
                try {
                    res.body = JSON.parse(res.body.toString());
                } catch (e) { }
            } else if (!res.body || Object.keys(res.body).length === 0) {
                try {
                    res.body = JSON.parse(res.text);
                } catch (e) { }
            }

            if (!res.body || !res.body.schemaVersion) {
                console.error('Admin pull manifest body:', JSON.stringify(res.body), 'Text:', res.text);
            }
            expect(res.body.schemaVersion).toBe(2);
        });

        it('should pull blob from proxy and cache it', async () => {
            upstreamHits = 0;
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/${imageName}/blobs/${blobDigest}`)
                .set('Authorization', `Bearer ${dockerToken}`);

            if (res.status !== 200) {
                console.error('Pull blob failed:', res.status, JSON.stringify(res.body));
            }
            expect(res.status).toBe(200);

            expect(res.body.toString()).toEqual(blobContent.toString());
            expect(upstreamHits).toBeGreaterThanOrEqual(1);

            // Second pull should be cached
            upstreamHits = 0;
            await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/${imageName}/blobs/${blobDigest}`)
                .set('Authorization', `Bearer ${dockerToken}`)
                .expect(200);
            expect(upstreamHits).toBe(0);
        });

        it('should revalidate tag-based manifest on every request', async () => {
            upstreamHits = 0;
            await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoName}/v2/${imageName}/manifests/${tag}`)
                .set('Authorization', `Bearer ${dockerToken}`)
                .expect(200);
            // Even if cached, Docker plugin should revalidate tag-based manifests
            expect(upstreamHits).toBeGreaterThanOrEqual(1);
        });
    });

    describe('🔐 Proxy Auth (Bearer Challenge)', () => {
        let authProxyRepoName = `docker-auth-proxy-${Date.now()}`;
        const imageName = 'needs-auth/image';
        const tag = 'v1';
        let dockerToken: string;

        beforeAll(() => {
            upstreamManifests[`${imageName}:${tag}`] = { hello: 'authenticated' };
        });

        it('should create an authenticated proxy', async () => {
            await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: authProxyRepoName,
                    type: 'proxy',
                    manager: 'docker',
                    config: {
                        upstream: `http://localhost:${mockRegistryPort}`,
                    }
                })
                .expect(201);
            await new Promise(r => setTimeout(r, 1000));
        });

        it('should get a docker token for auth proxy', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${authProxyRepoName}/v2/token`)
                .set('Authorization', `Bearer ${authToken}`)
                .query({ scope: `repository:${imageName}:pull` })
                .expect(200);
            dockerToken = res.body.token;
        });

        it('should handle authenticated proxying with token challenge', async () => {
            upstreamHits = 0;
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${authProxyRepoName}/v2/${imageName}/manifests/${tag}`)
                .set('Authorization', `Bearer ${dockerToken}`)
                .expect(200);

            expect(res.body.hello).toBe('authenticated');
            // Expect at least 1 hit (proving interaction happened and succeeded)
            expect(upstreamHits).toBeGreaterThanOrEqual(1);
            expect(lastRequestHeaders.authorization).toBe('Bearer mock-upstream-token');
        });
    });

    describe('👨‍👩‍👧‍👦 Docker Group Repositories', () => {
        let hostedRepoId: string;
        let proxyRepoId: string;
        let groupRepoId: string;
        const hostedName = `group-hosted-${Date.now()}`;
        const proxyName = `group-proxy-${Date.now()}`;
        const groupName = `group-docker-${Date.now()}`;
        let dockerToken: string;

        beforeAll(async () => {
            const hRes = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: hostedName, type: 'hosted', manager: 'docker', config: { docker: { port: 0 } } });
            hostedRepoId = hRes.body.id;

            const pRes = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: proxyName, type: 'proxy', manager: 'docker', config: { target: `http://localhost:${mockRegistryPort}` } });
            proxyRepoId = pRes.body.id;

            await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: groupName,
                    type: 'group',
                    manager: 'docker',
                    config: {
                        members: [hostedRepoId, proxyRepoId]
                    }
                })
                .expect(201);

            await new Promise(r => setTimeout(r, 1000));
            upstreamManifests['shared:image'] = { source: 'proxy' };
        });

        it('should get a docker token for the group', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${groupName}/v2/token`)
                .set('Authorization', `Bearer ${authToken}`)
                .query({ scope: `repository:shared:pull` })
                .expect(200);
            dockerToken = res.body.token;
        });

        it('should pull from group (delegating to members)', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${groupName}/v2/shared/manifests/image`)
                .set('Authorization', `Bearer ${dockerToken}`)
                .expect(200);

            expect(res.body.source).toBe('proxy');
        });
    });

    describe('🌐 Docker Hub library/ Normalization', () => {
        const dhProxyName = `dh-proxy-${Date.now()}`;
        let dockerToken: string;

        it('should create a dh-simulated proxy', async () => {
            await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: dhProxyName,
                    type: 'proxy',
                    manager: 'docker',
                    config: {
                        target: `http://localhost:${mockRegistryPort}`,
                        isDockerHub: true
                    }
                })
                .expect(201);
            await new Promise(r => setTimeout(r, 1000));
        });

        it('should get token for dh proxy', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${dhProxyName}/v2/token`)
                .set('Authorization', `Bearer ${authToken}`)
                .query({ scope: `repository:nginx:pull` })
                .expect(200);
            dockerToken = res.body.token;
        });

        it('should add library/ prefix for Docker Hub targets', async () => {
            upstreamManifests['library/nginx:latest'] = { name: 'nginx-library' };

            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${dhProxyName}/v2/nginx/manifests/latest`)
                .set('Authorization', `Bearer ${dockerToken}`)
                .expect(200);

            expect(res.body.name).toBe('nginx-library');
        });
    });
});
