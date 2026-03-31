/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 */

import request from 'supertest';
import { setupTestApp, cleanupTestApp, TestContext } from './test-helpers';

describe('System Management E2E', () => {
  let context: TestContext;
  let authToken: string;
  let cleanupPolicyId: string;

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

    it('should get plugin schema details', async () => {
      const listRes = await request(context.app.getHttpServer())
        .get('/api/plugins')
        .set('Authorization', `Bearer ${authToken}`);

      if (listRes.body.length > 0) {
        const pluginKey = listRes.body[0].key;
        const res = await request(context.app.getHttpServer())
          .get(`/api/plugins/${pluginKey}/schema`)
          .set('Authorization', `Bearer ${authToken}`)
          .expect(200);

        expect(res.body).toHaveProperty('found', true);
        expect(res.body).toHaveProperty('schema');
      }
    });
  });

  describe('📊 System Monitor', () => {
    it('should get system metrics', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/monitor/metrics')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('uptime');
    });

    it('should get system ready status', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/health/ready')
        .expect(200);

      expect(res.body).toHaveProperty('ok');
      expect(res.body).toHaveProperty('db');
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
    it('should list cleanup policies', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/cleanup/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBeTruthy();
    });

    it('should create and get cleanup policy details', async () => {
      const createRes = await request(context.app.getHttpServer())
        .post('/api/cleanup/policies')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: `cleanup-e2e-${Date.now()}`,
          description: 'Policy for e2e validation',
          enabled: true,
          target: 'docker-blobs',
          strategy: 'age-based',
          maxAgeDays: 30,
          frequency: 'daily',
          scheduleTime: '02:00',
        })
        .expect(201);

      cleanupPolicyId = createRes.body.id;
      expect(createRes.body).toHaveProperty('id');
      expect(createRes.body).toHaveProperty('target', 'docker-blobs');

      const res = await request(context.app.getHttpServer())
        .get(`/api/cleanup/policies/${cleanupPolicyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body).toHaveProperty('id', cleanupPolicyId);
      expect(res.body).toHaveProperty('name');
    });

    it('should trigger cleanup policy execution', async () => {
      const res = await request(context.app.getHttpServer())
        .post(`/api/cleanup/policies/${cleanupPolicyId}/execute`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(201);

      expect(res.body).toHaveProperty('deleted');
      expect(res.body).toHaveProperty('freedBytes');
    });

    it('should delete cleanup policy after execution', async () => {
      await request(context.app.getHttpServer())
        .delete(`/api/cleanup/policies/${cleanupPolicyId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });
});
