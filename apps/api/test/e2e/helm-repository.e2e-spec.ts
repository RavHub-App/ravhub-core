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

describe('Helm Repository E2E', () => {
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

    describe('⚓ Helm Hosted Repositories', () => {
        const repoName = `helm-hosted-${Date.now()}`;
        const chartName = 'test-chart';
        const chartVersion = '0.1.0';
        let repoId: string;

        it('should create a new hosted helm repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'helm',
                    config: {}
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should upload a helm chart (.tgz) via POST (upload endpoint)', async () => {
            // Helm often uses POST to a specific upload endpoint or PUT to the path
            const res = await request(context.app.getHttpServer())
                .post(`/api/repository/${repoId}/upload`)
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: chartName,
                    version: chartVersion,
                    filename: `${chartName}-${chartVersion}.tgz`,
                    content: Buffer.from('mock helm chart content').toString('base64'),
                    encoding: 'base64'
                })
                .expect(201);

            expect(res.body.ok).toBe(true);
            expect(res.body.id).toBe(`${chartName}-${chartVersion}.tgz`);
        });

        it('should download the index.yaml', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/index.yaml`)
                .expect(200);

            expect(res.text).toContain('apiVersion: v1');
            expect(res.text).toContain(chartName);
            expect(res.text).toContain(chartVersion);
        });

        it('should download the chart file', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/${chartName}-${chartVersion}.tgz`)
                .expect(200);

            expect(res.body.toString()).toBe('mock helm chart content');
        });

        it('should list packages and find the uploaded one', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            const found = res.body.packages.find((p: any) => p.name === chartName);
            expect(found).toBeDefined();
            expect(found.latestVersion).toBe(chartVersion);
        });
    });

    describe('🌐 Helm Proxy Repositories', () => {
        const repoName = `helm-proxy-${Date.now()}`;
        let repoId: string;

        it('should create a helm proxy repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'proxy',
                    manager: 'helm',
                    config: {
                        url: 'https://charts.bitnami.com/bitnami'
                    }
                })
                .expect(201);

            repoId = res.body.id;
        });

        it('should download index.yaml from proxy repo', async () => {
            // Helm proxy serves directly or from storage
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/index.yaml`);

            expect([200, 404, 302, 502, 504]).toContain(res.status);
        }, 15000);

        it('should cleanup helm repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
