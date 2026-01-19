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

describe('Proxy Cache Management E2E', () => {
    let context: TestContext;
    let authToken: string;
    let proxyRepoId: string;

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
                name: `proxy-cache-test-${Date.now()}`,
                type: 'proxy',
                manager: 'npm',
                config: {
                    npm: { proxyUrl: 'https://registry.npmjs.org' },
                    cacheTtlSeconds: 300,
                    auth: { type: 'none' }
                }
            });
        proxyRepoId = repoRes.body.id;
    });

    afterAll(async () => {
        if (proxyRepoId) {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${proxyRepoId}`)
                .set('Authorization', `Bearer ${authToken}`);
        }
        await cleanupTestApp(context.app);
    });

    describe('💾 Cache Operations', () => {
        it.skip('should get cache statistics for repository', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoId}/cache/stats`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body).toHaveProperty('cacheEntries');
        });

        it.skip('should clear repository cache', async () => {
            const res = await request(context.app.getHttpServer())
                .delete(`/api/repository/${proxyRepoId}/cache`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
        });

        it.skip('should get global cache statistics', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/repository/cache/stats')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
        });

        it.skip('should clear all proxy cache', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repository/cache/clear-all')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
        });
    });
});
