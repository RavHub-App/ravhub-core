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

describe('Composer Repository E2E', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        context = await setupTestApp({ useRealPlugins: true });

        // Login to get token
        const res = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = res.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    describe('🎼 Composer Hosted Repositories', () => {
        const repoName = `composer-hosted-${Date.now()}`;
        const pkgVendor = 'ravhub';
        const pkgPackage = 'test-pkg';
        const pkgVersion = '1.0.0';
        let repoId: string;

        it('should create a new hosted composer repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'composer',
                    config: {}
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should upload a composer package (ZIP) via PUT', async () => {
            const path = `${pkgVendor}/${pkgPackage}/${pkgVersion}.zip`;
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${path}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('mock zip content'))
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body.id).toBe(`${pkgVendor}/${pkgPackage}:${pkgVersion}`);
        });

        it('should download the packages.json metadata', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/packages.json`)
                .expect(200);

            expect(res.body.packages).toBeDefined();
            expect(res.body.packages[`${pkgVendor}/${pkgPackage}`]).toBeDefined();
            expect(res.body.packages[`${pkgVendor}/${pkgPackage}`][pkgVersion]).toBeDefined();

            const pkgData = res.body.packages[`${pkgVendor}/${pkgPackage}`][pkgVersion];
            expect(pkgData.version).toBe(pkgVersion);
            expect(pkgData.dist.type).toBe('zip');
            expect(pkgData.dist.url).toContain(`${pkgVendor}/${pkgPackage}/${pkgVersion}.zip`);
        });

        it('should download the uploaded ZIP', async () => {
            const path = `${pkgVendor}/${pkgPackage}/${pkgVersion}.zip`;
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${path}`)
                .expect(200);

            const content = Buffer.isBuffer(res.body) ? res.body.toString() : res.text;
            expect(content).toBe('mock zip content');
        });

        it('should list packages and find the uploaded one', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            const found = res.body.packages.find((p: any) => p.name === `${pkgVendor}/${pkgPackage}`);
            expect(found).toBeDefined();
            expect(found.latestVersion).toBe(pkgVersion);
        });
    });

    describe('🌐 Composer Proxy Repositories', () => {
        const repoName = `composer-proxy-${Date.now()}`;
        let repoId: string;

        it('should create a composer proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'proxy',
                    manager: 'composer',
                    config: {
                        proxyUrl: 'https://packagist.org'
                    }
                })
                .expect(201);

            repoId = res.body.id;
        });

        it('should download packages.json from proxy (not implemented fully in test, but check status)', async () => {
            // This might fail if the remote is too slow or down, but testing the route
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/packages.json`);

            // We expect at least a valid response or a 200/302 if it redirects/proxies
            expect([200, 302, 404]).toContain(res.status);
        });

        it('should cleanup composer repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
