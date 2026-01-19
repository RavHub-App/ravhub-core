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

describe('RBAC Advanced Management E2E', () => {
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

    describe('🎭 Role Management', () => {
        let testRoleId: string;

        it('should create a new role', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/rbac/roles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `test-role-${Date.now()}`,
                    description: 'Test role for E2E'
                })
                .expect(201);

            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('name');
            testRoleId = res.body.id;
        });

        it('should get role details', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/rbac/roles/${testRoleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.id).toBe(testRoleId);
        });

        it('should update role', async () => {
            const res = await request(context.app.getHttpServer())
                .put(`/api/rbac/roles/${testRoleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    description: 'Updated description'
                })
                .expect(200);

            expect(res.body.description).toBe('Updated description');
        });

        it('should delete role', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/rbac/roles/${testRoleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('🔐 Permission Assignment', () => {
        let roleId: string;

        beforeAll(async () => {
            const roleRes = await request(context.app.getHttpServer())
                .post('/api/rbac/roles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `perm-test-role-${Date.now()}`,
                    description: 'Role for permission testing'
                });
            roleId = roleRes.body.id;
        });

        afterAll(async () => {
            if (roleId) {
                await request(context.app.getHttpServer())
                    .delete(`/api/rbac/roles/${roleId}`)
                    .set('Authorization', `Bearer ${authToken}`);
            }
        });

        it('should assign permission to role', async () => {
            const permissionsRes = await request(context.app.getHttpServer())
                .get('/api/rbac/permissions')
                .set('Authorization', `Bearer ${authToken}`);

            const repoReadPerm = permissionsRes.body.find((p: any) => p.key === 'repo.read');

            if (repoReadPerm) {
                // Use update endpoint to assign permissions by KEY
                const res = await request(context.app.getHttpServer())
                    .put(`/api/rbac/roles/${roleId}`)
                    .set('Authorization', `Bearer ${authToken}`)
                    .send({
                        permissions: [repoReadPerm.key]
                    })
                    .expect(200);

                expect(res.body.permissions).toBeDefined();
                expect(res.body.permissions.some((p: any) => p.key === 'repo.read')).toBe(true);
            }
        });

        it('should get role with permissions', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/rbac/roles/${roleId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('permissions');
            expect(Array.isArray(res.body.permissions)).toBeTruthy();
        });
    });

    describe('👥 User Role Assignment', () => {
        let testUserId: string;
        let testRoleId: string;

        beforeAll(async () => {
            const userRes = await request(context.app.getHttpServer())
                .post('/api/users')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    username: `roletest-${Date.now()}`,
                    password: 'test123'
                });
            testUserId = userRes.body.id;

            const roleRes = await request(context.app.getHttpServer())
                .post('/api/rbac/roles')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `user-role-${Date.now()}`,
                    description: 'Role for user assignment'
                });
            testRoleId = roleRes.body.id;
        });

        afterAll(async () => {
            if (testUserId) {
                await request(context.app.getHttpServer())
                    .delete(`/api/users/${testUserId}`)
                    .set('Authorization', `Bearer ${authToken}`);
            }
            if (testRoleId) {
                await request(context.app.getHttpServer())
                    .delete(`/api/rbac/roles/${testRoleId}`)
                    .set('Authorization', `Bearer ${authToken}`);
            }
        });

        it('should assign role to user', async () => {
            // Get role to get its name
            const roleRes = await request(context.app.getHttpServer())
                .get(`/api/rbac/roles/${testRoleId}`)
                .set('Authorization', `Bearer ${authToken}`);

            const roleName = roleRes.body.name;

            // Use update user endpoint to assign roles by NAME
            const res = await request(context.app.getHttpServer())
                .put(`/api/users/${testUserId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    roles: [roleName]
                })
                .expect(200);

            expect(res.body.roles).toBeDefined();
            expect(res.body.roles.some((r: any) => r.name === roleName)).toBe(true);
        });

        it('should get user with roles', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/users/${testUserId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body).toHaveProperty('roles');
            expect(Array.isArray(res.body.roles)).toBeTruthy();
        });
    });
});
