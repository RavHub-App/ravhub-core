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

describe('RBAC Management E2E', () => {
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

    describe('🔐 Roles & Permissions', () => {
        it('should list roles', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/rbac/roles')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
            const adminRole = res.body.find((r: any) => r.name === 'admin');
            expect(adminRole).toBeDefined();
        });

        it('should list permissions', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/rbac/permissions')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
            const repoRead = res.body.find((p: any) => p.key === 'repo.read');
            expect(repoRead).toBeDefined();
        });
    });
});
