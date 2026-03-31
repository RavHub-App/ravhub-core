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

describe('User Management E2E', () => {
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

  describe('👥 User CRUD Operations', () => {
    let testUserId: string;

    it('should create a new user', async () => {
      const res = await request(context.app.getHttpServer())
        .post('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          username: `testuser-${Date.now()}`,
          password: 'testpass123',
        })
        .expect(201);

      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('username');
      testUserId = res.body.id;
    });

    it('should list users', async () => {
      const res = await request(context.app.getHttpServer())
        .get('/api/users')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBeTruthy();
      expect(res.body.length).toBeGreaterThan(0);
    });

    it('should get user details', async () => {
      const res = await request(context.app.getHttpServer())
        .get(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.id).toBe(testUserId);
    });

    it('should delete user', () => {
      return request(context.app.getHttpServer())
        .delete(`/api/users/${testUserId}`)
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);
    });
  });
});
