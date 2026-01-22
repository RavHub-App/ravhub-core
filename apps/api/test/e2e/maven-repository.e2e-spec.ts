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

describe('Maven Repository E2E', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        context = await setupTestApp({ useRealPlugins: true });

        // Login to get token
        const res = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = res.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    describe('☕ Maven Hosted Repositories', () => {
        const testRepo = {
            name: `maven-hosted-${Date.now()}`,
            type: 'hosted',
            manager: 'maven',
            config: {
                auth: { type: 'none' }
            }
        };

        let createdRepoId: string;

        it('should create a new hosted maven repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send(testRepo)
                .expect(201);

            expect(res.body).toHaveProperty('id');
            expect(res.body).toHaveProperty('name', testRepo.name);
            expect(res.body.manager).toBe('maven');
            createdRepoId = res.body.id;
        });

        it('should list maven repositories', async () => {
            const res = await request(context.app.getHttpServer())
                .get('/api/repository')
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            const found = res.body.find((r: any) => r.id === createdRepoId);
            expect(found).toBeDefined();
            expect(found.manager).toBe('maven');
        });

        it('should upload a maven artifact (PUT)', async () => {
            // Simulate: mvn deploy
            // Path: com/example/app/1.0.0/app-1.0.0.jar
            const groupId = 'com.example';
            const artifactId = 'app';
            const version = '1.0.0';
            const path = `${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.jar`;

            await request(context.app.getHttpServer())
                .put(`/api/repository/${testRepo.name}/${path}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/octet-stream')
                .send(Buffer.from('mock-jar-content'))
                .expect(200);
        });

        it('should download the uploaded artifact', async () => {
            const groupId = 'com.example';
            const artifactId = 'app';
            const version = '1.0.0';
            const path = `${groupId.replace(/\./g, '/')}/${artifactId}/${version}/${artifactId}-${version}.jar`;

            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${testRepo.name}/${path}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.text).toBe('mock-jar-content');
        });

        it('should delete the maven repository', () => {
            return request(context.app.getHttpServer())
                .delete(`/api/repository/${createdRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });

    describe('🌐 Maven Proxy Repositories', () => {
        const proxyRepo = {
            name: `maven-proxy-${Date.now()}`,
            type: 'proxy',
            manager: 'maven',
            config: {
                maven: {
                    proxyUrl: 'https://repo1.maven.org/maven2'
                },
                auth: { type: 'none' }
            }
        };

        let proxyRepoId: string;

        it('should create a maven proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send(proxyRepo)
                .expect(201);

            expect(res.body.type).toBe('proxy');
            expect(res.body.config.maven.proxyUrl).toBe('https://repo1.maven.org/maven2');
            proxyRepoId = res.body.id;
        });

        it('should update proxy configuration with cacheTtl', async () => {
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${proxyRepoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    config: {
                        ...proxyRepo.config,
                        cacheTtlSeconds: 600
                    }
                })
                .expect(200);

            expect(res.body.config.cacheTtlSeconds).toBe(600);
        });
    });
});
