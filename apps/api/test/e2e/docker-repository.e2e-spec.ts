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
import axios from 'axios';
import * as crypto from 'crypto';

describe('Docker Repository E2E', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        process.env.REGISTRY_PORT_START = '8000';
        process.env.REGISTRY_PORT_END = '8100';
        process.env.JWT_SECRET = 'test-secret';
        process.env.DEBUG_REGISTRY = 'true';
        process.env.DEBUG_GUARD = 'true';
        context = await setupTestApp({ useRealPlugins: true });

        // Make the app listen so the registry can proxy to it
        await context.app.listen(0);
        const address = context.app.getHttpServer().address();
        const port = address.port;
        process.env.API_URL = `http://localhost:${port}`;

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    describe('🐳 Docker Hosted Repositories', () => {
        const repoName = `docker-hosted-${Date.now()}`;
        const imageName = 'test-image';
        const tag = 'latest';
        let repoId: string;
        let registryPort: number;
        let dockerToken: string;

        it('should create a new hosted docker repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'docker',
                    config: {
                        docker: { port: 0 }
                    }
                })
                .expect(201);

            repoId = res.body.id;

            // Wait for it to start and persist port
            let attempts = 0;
            while (attempts < 15) {
                const repoRes = await request(context.app.getHttpServer())
                    .get(`/api/repository/${repoId}`)
                    .set('Authorization', `Bearer ${authToken}`)
                    .expect(200);

                registryPort = repoRes.body.config?.docker?.port;
                if (registryPort) break;
                await new Promise(r => setTimeout(r, 1000));
                attempts++;
            }

            expect(registryPort).toBeGreaterThan(0);
            // Extra wait for server to bind
            await new Promise(r => setTimeout(r, 1000));
        });

        it('should get a docker token via the API', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/v2/token`)
                .set('Authorization', `Bearer ${authToken}`)
                .query({
                    service: `localhost:${registryPort}`,
                    scope: `repository:${imageName}:pull,push`
                })
                .expect(200);

            expect(res.body.token).toBeDefined();
            dockerToken = res.body.token;
        });

        it('should upload a blob to the registry', async () => {
            const blobContent = Buffer.from('hello-docker-blob');
            const digest = `sha256:${crypto.createHash('sha256').update(blobContent).digest('hex')}`;

            // 1. Initiate upload
            const initRes = await axios.post(`http://localhost:${registryPort}/v2/${imageName}/blobs/uploads/`, {}, {
                headers: { Authorization: `Bearer ${dockerToken}` }
            });
            expect(initRes.status).toBe(202);
            const uploadUrl = initRes.headers['location'];
            expect(uploadUrl).toBeDefined();

            // 2. Finalize upload with content and digest
            // Need to handle relative or absolute Location
            const fullUploadUrl = uploadUrl.startsWith('http') ? uploadUrl : `http://localhost:${registryPort}${uploadUrl}`;

            const finalizeRes = await axios.put(`${fullUploadUrl}?digest=${digest}`, blobContent, {
                headers: {
                    Authorization: `Bearer ${dockerToken}`,
                    'Content-Type': 'application/octet-stream'
                }
            });
            expect(finalizeRes.status).toBe(201);
        });

        it('should push a manifest', async () => {
            const blobContent = Buffer.from('hello-docker-blob');
            const blobDigest = `sha256:${crypto.createHash('sha256').update(blobContent).digest('hex')}`;

            const manifest = {
                schemaVersion: 2,
                mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
                config: {
                    mediaType: 'application/vnd.docker.container.image.v1+json',
                    size: 2,
                    digest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a'
                },
                layers: [
                    {
                        mediaType: 'application/vnd.docker.image.rootfs.diff.tar.gzip',
                        size: blobContent.length,
                        digest: blobDigest
                    }
                ]
            };

            const res = await axios.put(`http://localhost:${registryPort}/v2/${imageName}/manifests/${tag}`, manifest, {
                headers: {
                    Authorization: `Bearer ${dockerToken}`,
                    'Content-Type': 'application/vnd.docker.distribution.manifest.v2+json'
                }
            });
            expect(res.status).toBe(201);
        });

        it('should pull the manifest back', async () => {
            const res = await axios.get(`http://localhost:${registryPort}/v2/${imageName}/manifests/${tag}`, {
                headers: { Authorization: `Bearer ${dockerToken}` }
            });
            expect(res.status).toBe(200);
            expect(res.data.schemaVersion).toBe(2);
        });

        it('should list tags for the image', async () => {
            const res = await axios.get(`http://localhost:${registryPort}/v2/${imageName}/tags/list`, {
                headers: { Authorization: `Bearer ${dockerToken}` }
            });
            expect(res.status).toBe(200);
            expect(res.data.tags).toContain(tag);
        });

        it('should find the image in the packages list', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            const found = res.body.packages.find((p: any) => p.name === imageName);
            expect(found).toBeDefined();
        });

        it('should cleanup the docker repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
