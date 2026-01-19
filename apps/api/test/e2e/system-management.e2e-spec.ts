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

describe('System Management E2E', () => {
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

    describe('🔌 Plugins', () => {
        it('should list available plugins', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/plugins')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
        });

        it.skip('should get plugin details', async () => {
            const listRes = await request(context.app.getHttpServer())
                .get('/api/plugins')
                .set('Authorization', `Bearer ${authToken}`);

            if (listRes.body.length > 0) {
                const pluginName = listRes.body[0].name;
                const res = await request(context.app.getHttpServer())
                    .get(`/api/plugins/${pluginName}`)
                    .set('Authorization', `Bearer ${authToken}`)
                    .expect(200);

                expect(res.body).toHaveProperty('name');
            }
        });
    });

    describe('📊 System Monitor', () => {
        it.skip('should get system metrics', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/monitor/metrics')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('ok');
        });

        it.skip('should get system status', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/monitor/status')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('ok');
        });
    });

    describe('📝 Audit Logs', () => {
        it('should list audit logs', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/audit')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('logs');
            expect(Array.isArray(res.body.logs)).toBeTruthy();
            expect(res.body).toHaveProperty('total');
        });

        it('should filter audit logs by action', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/audit?action=login')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('logs');
            expect(Array.isArray(res.body.logs)).toBeTruthy();
        });
    });

    describe('🧹 Cleanup Operations', () => {
        it.skip('should get cleanup status', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/cleanup/status')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('ok');
        });

        it.skip('should trigger cleanup', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/cleanup/run')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('ok');
        });
    });
});
