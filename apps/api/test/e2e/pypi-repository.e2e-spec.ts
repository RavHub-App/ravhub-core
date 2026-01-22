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

describe('PyPI Repository E2E', () => {
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

    describe('📦 PyPI Hosted Repositories', () => {
        const repoName = `pypi-hosted-${Date.now()}`;
        const pkgName = 'e2e-test-pkg';
        const version = '1.0.0';
        let repoId: string;

        it('should create a new hosted pypi repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'pypi',
                    config: { auth: { type: 'none' } }
                })
                .expect(201);

            repoId = res.body.id;
        });

        it('should upload a pypi package (POST)', async () => {
            // PyPI usually uses multipart/form-data with 'content' and metadata
            // But the internal plugin handlePut often takes the raw body as the file
            // if it's a direct artifact upload. Let's try the direct path.

            const filename = `${pkgName}-${version}.tar.gz`;
            const content = Buffer.from('mock pypi tarball content');

            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${pkgName}/${version}/${filename}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(content);

            expect([200, 201]).toContain(res.status);
        });

        it('should download the pypi package', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${pkgName}/${version}`)
                .expect(200);

            expect(res.body.toString()).toBe('mock pypi tarball content');
            expect(res.headers['content-type']).toBe('application/octet-stream');
        });

        it('should enforce redeployment policy', async () => {
            // Update repo to disallow redeploy
            await request(context.app.getHttpServer())
                .put(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({ config: { allowRedeploy: false } })
                .expect(200);

            const filename = `${pkgName}-${version}.tar.gz`;
            const content = Buffer.from('different content');

            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${pkgName}/${version}/${filename}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(content)
                .expect(400); // Bad Request or conflict depending on impl, usually 400 with message

            expect(res.body.message).toContain('Redeployment');
        });

        it('should delete the pypi repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('👨‍👩‍👧‍👦 PyPI Group Repositories', () => {
        const hostedName = `pypi-member-${Date.now()}`;
        const groupName = `pypi-group-${Date.now()}`;
        let hostedId: string;
        let groupId: string;
        const pkgName = 'group-pkg';
        const version = '2.0.0';

        it('should create hosted member', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: hostedName,
                    type: 'hosted',
                    manager: 'pypi',
                    config: { auth: { type: 'none' }, allowRedeploy: false },
                })
                .expect(201);
            hostedId = res.body.id;
        });

        it('should create group repo with write policy', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: groupName,
                    type: 'group',
                    manager: 'pypi',
                    config: {
                        members: [hostedId],
                        writePolicy: 'first',
                        auth: { type: 'none' },
                    },
                })
                .expect(201);
            groupId = res.body.id;
        });

        it('should upload to group and delegate to member', async () => {
            const filename = `${pkgName}-${version}.tar.gz`;
            const content = Buffer.from('group upload content');

            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${groupName}/${pkgName}/${version}/${filename}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(content)
                .expect(200);

            expect(res.body.ok).toBe(true);
        });

        it('should download from group', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${groupName}/${pkgName}/${version}`)
                .expect(200);

            expect(res.body.toString()).toBe('group upload content');
        });

        it('should verify artifact exists in member hosted repo', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${hostedName}/${pkgName}/${version}`)
                .expect(200);

            expect(res.body.toString()).toBe('group upload content');
        });

        it('should cleanup repos', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${groupId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${hostedId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
