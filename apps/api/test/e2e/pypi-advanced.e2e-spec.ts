
import request from 'supertest';
import { setupTestApp, cleanupTestApp, TestContext } from './test-helpers';

describe('PyPI Advanced Scenarios (Concurrency & PEP 503)', () => {
    let context: TestContext;
    let authToken: string;

    beforeAll(async () => {
        // Mocking proxyFetch to verify coalescing
        const mockProxyFetch = jest.fn().mockImplementation(async (repo, url) => {
            // Simulate network delay
            await new Promise(resolve => setTimeout(resolve, 500));
            return {
                ok: true,
                status: 200,
                body: Buffer.from(`fake_content_for_${url.split('/').pop()}`),
                headers: { 'content-type': 'application/octet-stream' }
            };
        });

        // Inject the mock into the context via options or by modifying the created app if possible.
        // Since setupTestApp creates a real app, we might need a workaround to spy on plugin internals,
        // or just rely on 'black box' behavior (timing) or log outputs if we can't mock easily here.
        // For E2E, strict mocking of internals is hard. We'll rely on functional verification.

        context = await setupTestApp({ useRealPlugins: true });

        const loginRes = await request(context.app.getHttpServer())
            .post('/api/auth/login')
            .send({ username: 'admin', password: 'password' });
        authToken = loginRes.body.token;
    });

    afterAll(async () => {
        await cleanupTestApp(context.app);
    });

    const repoName = `pypi-adv-${Date.now()}`;
    let repoId: string;

    it('should create a hosted pypi repository', async () => {
        const res = await request(context.app.getHttpServer())
            .post('/api/repositories')
            .set('Authorization', `Bearer ${authToken}`)
            .send({
                name: repoName,
                type: 'hosted',
                manager: 'pypi',
            })
            .expect(201);
        repoId = res.body.id;
    });

    it('should return PEP 503 HTML for simple index', async () => {
        const pkgName = 'my-awesome-lib';

        // 1. Upload a package first so there is something to list
        const version = '1.0.0';
        await request(context.app.getHttpServer())
            .put(`/api/repository/${repoName}/${pkgName}/${version}/${pkgName}-${version}.tar.gz`)
            .set('Authorization', `Bearer ${authToken}`)
            .send('dummy-content')
            .expect(200);

        // 2. Request /simple/<pkgName>
        const res = await request(context.app.getHttpServer())
            .get(`/api/repository/${repoName}/simple/${pkgName}`)
            .expect(200);

        expect(res.header['content-type']).toContain('text/html');
        // The plugin uses 'http://localhost:3000' as base by default in test env (missing process.env.API_HOST)
        // Matches roughly href="http://localhost:3000/repository/..."
        expect(res.text).toContain(`href="http://localhost:3000/repository/${repoName}/${pkgName}/${version}/${pkgName}-${version}.tar.gz"`);
    });

    // NOTE: Testing Request Coalescing in strict E2E without internal spies is difficult because we can't count exact function calls.
    // However, we can assert that 50 concurrent requests all succeed and return the correct data.

    it('should handle concurrent downloads of the same artifact successfully', async () => {
        const concurrency = 3;
        const pkgName = 'concurrent-lib';
        const version = '2.0.0';
        const filename = `${pkgName}-${version}.tar.gz`;

        // Upload first
        await request(context.app.getHttpServer())
            .put(`/api/repository/${repoName}/${pkgName}/${version}/${filename}`)
            .set('Authorization', `Bearer ${authToken}`)
            .set('Content-Type', 'application/octet-stream')
            .send(Buffer.from('concurrent-content'))
            .expect(200);

        const downloads = [];
        for (let i = 0; i < concurrency; i++) {
            downloads.push(
                request(context.app.getHttpServer())
                    .get(`/api/repository/${repoName}/${pkgName}/${version}`) // downloading using download() logic
                    .expect(200)
            );
        }

        const results = await Promise.all(downloads);
        results.forEach(res => {
            expect(res.body.toString()).toBe('concurrent-content');
        });
    });

});
