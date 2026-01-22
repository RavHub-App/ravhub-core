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

describe('Repository Advanced Features E2E', () => {
    let context: TestContext;
    let authToken: string;
    let testRepoId: string;

    beforeAll(async () => {
        context = await setupTestApp();

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;

        const repoRes = await request(context.app.getHttpServer())
            .post('/api/repositories')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                name: `advanced-test-${Date.now()}`,
                type: 'hosted',
                manager: 'npm',
                config: { auth: { type: 'none' } }
            });
        testRepoId = repoRes.body.id;
    });

    afterAll(async () => {
        if (testRepoId) {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${testRepoId}`)
                .set('Authorization', `Bearer ${authToken}`);
        }
        await cleanupTestApp(context.app);
    });

    describe('📊 Repository Metadata', () => {
        it('should get repository metadata with capabilities', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${testRepoId}/metadata`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body).toHaveProperty('capabilities');
            expect(res.body).toHaveProperty('audit');
            expect(res.body).toHaveProperty('state');
        });
    });

    describe('📦 Package Operations', () => {
        it('should list packages in repository', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${testRepoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(Array.isArray(res.body.packages)).toBeTruthy();
        });

        it('should scan repository artifacts', async () => {
            const res = await request(context.app.getHttpServer())
                .post(`/api/repository/${testRepoId}/scan`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(201); // Scan creation usually returns 201

            expect(res.body).toHaveProperty('ok');
        });
    });

    describe('🔐 Repository Permissions', () => {
        let testUserId: string;

        beforeAll(async () => {
            const userRes = await request(context.app.getHttpServer())
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username: `permtest-${Date.now()}`,
                    password: 'test123'
                });
            testUserId = userRes.body.id;
        });

        afterAll(async () => {
            if (testUserId) {
                await request(context.app.getHttpServer())
                    .delete(`/api/users/${testUserId}`)
                    .set('Authorization', `Bearer ${authToken}`);
            }
        });

        it('should grant user permission to repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post(`/api/repository/${testRepoId}/permissions/user`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    userId: testUserId,
                    permission: 'read'
                })
                .expect(201);

            expect(res.body).toHaveProperty('id');
        });

        it('should list repository permissions', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${testRepoId}/permissions`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
            expect(res.body.length).toBeGreaterThan(0);
        });
    });
});
