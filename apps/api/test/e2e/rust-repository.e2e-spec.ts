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

describe('Rust Repository E2E', () => {
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

    describe('📦 Rust Hosted Repositories', () => {
        const repoName = `rust-hosted-${Date.now()}`;
        const crateName = 'ravhub-test-crate';
        const crateVersion = '0.1.0';
        let repoId: string;

        it('should create a new hosted rust repository', async () => {
            const res = await request(context.app.getHttpServer())
                .post('/api/repositories')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: repoName,
                    type: 'hosted',
                    manager: 'rust',
                    config: {}
                })
                .expect(201);

            repoId = res.body.id;
            expect(repoId).toBeDefined();
        });

        it('should download config.json', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/config.json`)
                .expect(200);

            expect(res.body.dl).toContain(`/repository/${repoName}/crates/{crate}/{version}/download`);
            expect(res.body.api).toContain(`/repository/${repoName}`);
        });

        it('should upload a rust crate (.crate) via PUT', async () => {
            const fileName = `${crateName}-${crateVersion}.crate`;
            const res = await request(context.app.getHttpServer())
                .put(`/api/repository/${repoName}/${fileName}`)
                .set('Authorization', `Bearer ${authToken}`)
                .send(Buffer.from('mock crate content'))
                .expect(200);

            expect(res.body.ok).toBe(true);
            expect(res.body.id).toBe(`${crateName}:${crateVersion}`);
        });

        it('should download the crate', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/crates/${crateName}/${crateVersion}/download`)
                .expect(200);

            expect(res.body.toString()).toBe('mock crate content');
        });

        it('should check the index for the crate', async () => {
            // Index path for 'ravhub-test-crate' (length > 4) -> 'ra/vh/ravhub-test-crate'
            // Wait, getIndexPath implementation:
            // if (len === 1) return `1/${lower}`;
            // if (len === 2) return `2/${lower}`;
            // if (len === 3) return `3/${lower.substring(0, 1)}/${lower}`;
            // return `${lower.substring(0, 2)}/${lower.substring(2, 4)}/${lower}`;
            const indexPath = 'ra/vh/ravhub-test-crate';
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoName}/index/${indexPath}`)
                .expect(200);

            const entries = res.text.split('\n').filter(l => l).map(l => JSON.parse(l));
            const found = entries.find(e => e.vers === crateVersion);
            expect(found).toBeDefined();
            expect(found.name).toBe(crateName);
        });

        it('should list packages and find the uploaded one', async () => {
            const res = await request(context.app.getHttpServer())
                .get(`/api/repository/${repoId}/packages`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);

            expect(res.body.ok).toBe(true);
            const found = res.body.packages.find((p: any) => p.name === crateName);
            expect(found).toBeDefined();
            expect(found.latestVersion).toBe(crateVersion);
        });

        it('should cleanup rust repository', async () => {
            await request(context.app.getHttpServer())
                .delete(`/api/repository/${repoId}`)
                .set('Authorization', `Bearer ${authToken}`)
                .expect(200);
        });
    });
});
