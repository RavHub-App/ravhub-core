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

describe('NuGet Repository E2E', () => {
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

    describe('📦 NuGet Hosted Repositories (V3)', () => {
        const repoName = `nuget-hosted-${Date.now()}`;
        const pkgName = 'RavHub.TestPkg';
        const pkgVersion = '1.0.0';
        let repoId: string;

        it('should create a new hosted nuget repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'nuget',
                    config: { nuget: { version: 'v3' } }
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should upload a nuget package (.nupkg) via PUT', async () => {
            const fileName = `${pkgName}.${pkgVersion}.nupkg`;
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${pkgName}/${pkgVersion}/${fileName}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('mock nupkg content'))
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body.id.toLowerCase()).toBe(`${pkgName.toLowerCase()}:${pkgVersion}`);
        });

        it('should download the V3 service index', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/index.json`)
                .expect(200);

            expect(res.body.version).toBe('3.0.0');
            expect(Array.isArray(res.body.resources)).toBe(true);

            // Should contain PackageBaseAddress
            const flatContainer = res.body.resources.find((r: any) => r['@type'] === 'PackageBaseAddress/3.0.0');
            expect(flatContainer).toBeDefined();
            expect(flatContainer['@id']).toContain(`/repository/${repoName}/v3/flatcontainer/`);
        });

        it('should download the package using flatcontainer path', async () => {
            const fileName = `${pkgName}.${pkgVersion}.nupkg`.toLowerCase();
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/v3/flatcontainer/${pkgName.toLowerCase()}/${pkgVersion}/${fileName}`)
                .expect(200);

            expect(res.body.toString()).toBe('mock nupkg content');
        });

        it('should download the package using legacy path', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/package/${pkgName}/${pkgVersion}`)
                .expect(200);

            expect(res.body.toString()).toBe('mock nupkg content');
        });

        it('should list packages and find the uploaded one', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            const found = res.body.packages.find((p: any) => p.name.toLowerCase() === pkgName.toLowerCase());
            expect(found).toBeDefined();
            expect(found.latestVersion).toBe(pkgVersion);
        });

        it('should enforce no-redeploy policy if configured', async () => {
            // Update repo to disallow redeploy
            await request(context.app.getHttpServer())
                .put(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    config: { nuget: { allowRedeploy: false } }
                })
                .expect(200);

            // Try to upload same version again
            const fileName = `${pkgName}.${pkgVersion}.nupkg`;
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${pkgName}/${pkgVersion}/${fileName}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(Buffer.from('second attempt'))
                .expect(400);

            expect(res.body.message.toLowerCase()).toContain(`redeployment of ${pkgName.toLowerCase()}:${pkgVersion} is not allowed`);
        });
    });

    describe('🌐 NuGet Proxy Repositories', () => {
        const repoName = `nuget-proxy-${Date.now()}`;
        let repoId: string;

        it('should create a nuget proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'proxy',
                    manager: 'nuget',
                    config: {
                        proxyUrl: 'https://api.nuget.org/v3/index.json',
                        nuget: { version: 'v3' }
                    }
                })
                .expect(201);

            repoId = res.body.id;
        });

        it('should cleanup nuget repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
