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

describe('Repository Management E2E', () => {
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

    describe('📦 Hosted Repositories', () => {
        const testRepo = {
            name: `e2e-test-repo-${Date.now()}`,
            type: 'hosted',
            manager: 'npm',
            config: {
                auth: { type: 'none' }
            }
        };

        let createdRepoId: string;

        it('should create a new hosted repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send(testRepo)
                .expect(201);

            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('name', testRepo.name);
            createdRepoId = res.body.id;
        });

        it('should list repositories and find the created one', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/repository')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(Array.isArray(res.body)).toBeTruthy();
            const found = res.body.find((r: any) => r.id === createdRepoId);
            expect(found).toBeDefined();
            expect(found.name).toBe(testRepo.name);
        });

        it('should get repository details', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${createdRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.id).toBe(createdRepoId);
        });

        it('should delete the repository', () => {
            return request(context.app.getHttpServer())
                .delete(`/api/repository/${createdRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('📡 Proxy Repositories', () => {
        const proxyRepo = {
            name: `proxy-npm-${Date.now()}`,
            type: 'proxy',
            manager: 'npm',
            config: {
                npm: {
                    proxyUrl: 'https://registry.npmjs.org'
                },
                auth: { type: 'none' }
            }
        };

        let proxyRepoId: string;

        it('should create a proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send(proxyRepo)
                .expect(201);

            expect(res.body).toHaveProperty('id');
            expect(res.body.type).toBe('proxy');
            proxyRepoId = res.body.id;
        });

        it('should get proxy repository details', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${proxyRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.type).toBe('proxy');
            expect(res.body.config.npm.proxyUrl).toBe('https://registry.npmjs.org');
        });

        it('should update proxy repository configuration', async () => {
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${proxyRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    config: {
                        ...proxyRepo.config,
                        cacheTtlSeconds: 300
                    }
                })
                .expect(200);

            expect(res.body.config.cacheTtlSeconds).toBe(300);
        });

        it('should delete proxy repository', () => {
            return request(context.app.getHttpServer())
                .delete(`/api/repository/${proxyRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('🗂️ Group Repositories', () => {
        let member1Id: string;
        let member2Id: string;
        let groupRepoId: string;

        it('should create member repositories', async () => {
            const res1 = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `member-1-${Date.now()}`,
                    type: 'hosted',
                    manager: 'npm',
                    config: { auth: { type: 'none' } }
                })
                .expect(201);
            member1Id = res1.body.id;

            const res2 = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `member-2-${Date.now()}`,
                    type: 'hosted',
                    manager: 'npm',
                    config: { auth: { type: 'none' } }
                })
                .expect(201);
            member2Id = res2.body.id;
        });

        it('should create a group repository with members', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: `group-npm-${Date.now()}`,
                    type: 'group',
                    manager: 'npm',
                    config: {
                        members: [member1Id, member2Id],
                        auth: { type: 'none' }
                    }
                })
                .expect(201);

            expect(res.body.type).toBe('group');
            groupRepoId = res.body.id;
        });

        it('should get group members', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${groupRepoId}/members`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body.members).toHaveLength(2);
        });

        it('should cleanup group and members', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${groupRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            await request(context.app.getHttpServer())
                .delete(`/api/repository/${member1Id}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            await request(context.app.getHttpServer())
                .delete(`/api/repository/${member2Id}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
