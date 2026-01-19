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

describe('Authentication Advanced E2E', () => {
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

    describe('🔑 Token Management', () => {
        let refreshToken: string;

        it('should get current user info', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/auth/me')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.user).toHaveProperty('username', 'admin');
            expect(res.body.user).toHaveProperty('id');
        });

        it('should login and receive refresh token', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/auth/login')
                .send({ username: 'admin', password: 'password' })
                .expect(201);

            expect(res.body).toHaveProperty('token');
            expect(res.body).toHaveProperty('refreshToken');
            refreshToken = res.body.refreshToken;
        });

        it('should refresh access token', async () => {
            if (refreshToken) {
                const res = await request(context.app.getHttpServer())
                    .post('/api/auth/refresh')
                    .send({ refreshToken })
                    .expect(201);

                expect(res.body).toHaveProperty('token');
            }
        });
    });

    describe('👤 User Registration', () => {
        it('should check bootstrap status', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/auth/bootstrap-status')
                .expect(200);

            expect(res.body).toHaveProperty('bootstrapRequired');
        });

        it('should allow user signup', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/auth/signup')
                .send({
                    username: `newuser-${Date.now()}`,
                    password: 'newpass123'
                })
                .expect(201);

            expect(res.body).toHaveProperty('token');
        });
    });
});
