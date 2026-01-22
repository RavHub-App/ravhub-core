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

describe('Raw Repository E2E', () => {
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

    describe('📁 Raw Hosted Repositories', () => {
        const repoName = `raw-hosted-${Date.now()}`;
        const filePath = 'folder/subfolder/test-file.txt';
        const fileContent = 'Hello Raw Storage!';
        let repoId: string;

        it('should create a new hosted raw repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'raw',
                    config: {}
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should upload a file via PUT to a deep path', async () => {
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${filePath}`)
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'text/plain')
                .send(fileContent)
                .expect(200);

            expect(res.body.ok).toBe(true);
        });

        it('should download the uploaded file', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${filePath}`)
                .expect(200);

            const content = Buffer.isBuffer(res.body) ? res.body.toString() : res.text;
            expect(content).toBe(fileContent);
        });

        it('should list artifacts in the repository', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            // After normalization in scanRepoArtifacts or handlePut
            const found = res.body.packages.find((p: any) => p.name === filePath);
            expect(found).toBeDefined();
        });
    });

    describe('🚫 Raw Policy Enforcements', () => {
        const repoName = `raw-locked-${Date.now()}`;
        let repoId: string;

        it('should create a raw repository with no-redeploy', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'raw',
                    config: { allowRedeploy: false }
                })
                .expect(201);
            repoId = res.body.id;
        });

        it('should fail to re-upload the same file', async () => {
            const path = 'locked-file.bin';
            // First time
            await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${path}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send('first')
                .expect(200);

            // Second time
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${path}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send('second')
                .expect(400);

            expect(res.body.message).toContain('Redeployment');
        });
    });
});
