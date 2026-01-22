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

describe('Storage Configuration E2E', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        context = await setupTestApp();

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    describe('💾 Storage Backends', () => {
        it('should list storage configurations', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/storage/configs')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
        });

        it('should get default storage configuration', async () => {
            const listRes = await request(context.app.getHttpServer())
                .get('/api/storage/configs')
                .set('Authorization', `Bearer ${authToken}`);

            const defaultStorage = listRes.body.find((s: any) => s.isDefault);
            if (defaultStorage) {
                const res = await request(context.app.getHttpServer())
                    .get(`/api/storage/configs/${defaultStorage.id}`)
                    .set('Authorization', `Bearer ${authToken}`)
                    .expect(200);

                expect(res.body).toHaveProperty('id');
                expect(res.body.isDefault).toBe(true);
            }
        });
    });

    describe('🔄 Repository Storage Migration', () => {
        let testRepoId: string;

        beforeAll(async () => {
            // ... (setup code remains in beforeAll, just enabling the test below)
            const repoRes = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `storage-test-${Date.now()}`,
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
        });

        it('should handle storage migration request', async () => {
            const res = await request(context.app.getHttpServer())
                .post(`/api/repository/${testRepoId}/migrate-storage`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    newStorageId: null
                })
                .expect(201);

            expect(res.body).toHaveProperty('ok');
        });
    });
});
