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

describe('Health & Authentication E2E', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await setupTestApp();
  });

  afterAll(async () => {
    await cleanupTestApp(context.app);
  });

  describe('🟢 System Health', () => {
    it('/health (GET) should return 200 OK', () => {
      return request(context.app.getHttpServer())
        .get('/api/health')
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('ok', true);
        });
    });
  });

  describe('🔐 Authentication', () => {
    it('should reject invalid credentials', () => {
      return request(context.app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'invalid', password: 'wrong' })
        .expect(401);
    });

    it('should login successfully with default admin credentials', () => {
      return request(context.app.getHttpServer())
        .post('/api/auth/login')
        .send({ username: 'admin', password: 'password' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('token');
          context.authToken = res.body.token;
        });
    });
  });
});
