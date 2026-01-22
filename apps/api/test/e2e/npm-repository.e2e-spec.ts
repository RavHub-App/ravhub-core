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

describe('NPM Repository E2E', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        context = await setupTestApp({ useRealPlugins: true });

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    describe('📦 NPM Hosted Repositories', () => {
        const repoName = `npm-hosted-${Date.now()}`;
        const pkgName = 'e2e-test-pkg';
        let repoId: string;

        it('should create a new hosted npm repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'npm',
                    config: { auth: { type: 'none' } }
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should publish an npm package (PUT)', async () => {
            // Mocking a standard NPM publish body
            const publishPayload = {
                name: pkgName,
                'dist-tags': { latest: '1.0.0' },
                versions: {
                    '1.0.0': {
                        name: pkgName,
                        version: '1.0.0',
                        dist: {
                            tarball: `http://localhost:3000/repository/${repoName}/${pkgName}/-/${pkgName}-1.0.0.tgz`,
                            shasum: '76c8c835252875bbed48356980bf8031a0e1bba6' // dummy
                        }
                    }
                },
                _attachments: {
                    [`${pkgName}-1.0.0.tgz`]: {
                        content_type: 'application/octet-stream',
                        data: Buffer.from('mock tarball content').toString('base64'),
                        length: 20
                    }
                }
            };

            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${pkgName}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(publishPayload);

            expect([200, 201]).toContain(res.status);
        });

        it('should download the package metadata', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${pkgName}`)
                .expect(200);

            expect(res.body.name).toBe(pkgName);
            expect(res.body['dist-tags'].latest).toBe('1.0.0');
        });

        it('should download the package tarball', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${pkgName}/-/${pkgName}-1.0.0.tgz`)
                .expect(200);

            expect(res.body.toString()).toBe('mock tarball content');
            expect(res.headers['content-type']).toBe('application/octet-stream');
        });

        it('should list artifacts and find the published package', async () => {
            // Wait slightly for background indexing if needed (though it should be sync in E2E)
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(Array.isArray(res.body.packages)).toBeTruthy();
            const found = res.body.packages.find((p: any) => p.name === pkgName);
            expect(found).toBeDefined();
            expect(found.latestVersion).toBe('1.0.0');
        });

        it('should delete the npm repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('🌐 NPM Proxy Repositories', () => {
        const repoName = `npm-proxy-${Date.now()}`;
        let repoId: string;

        it('should create an npm proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'proxy',
                    manager: 'npm',
                    config: {
                        npm: { proxyUrl: 'https://registry.npmjs.org' },
                        auth: { type: 'none' }
                    }
                })
                .expect(201);

            repoId = res.body.id;
        });

        it('should update proxy configuration', async () => {
            await request(context.app.getHttpServer())
                .put(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    config: {
                        npm: { proxyUrl: 'https://registry.npmjs.org' },
                        cacheTtlSeconds: 600
                    }
                })
                .expect(200);
        });

        it('should cleanup proxy repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
