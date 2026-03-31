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
import { TestContext, cleanupTestApp, setupTestApp } from './e2e/test-helpers';

describe('AppController (e2e)', () => {
  let context: TestContext;

  beforeEach(async () => {
    context = await setupTestApp();
  });

  afterEach(async () => {
    await cleanupTestApp(context?.app);
  });

  it('/ (GET)', async () => {
    const res = await request(context.app.getHttpServer())
      .get('/api')
      .expect(200);

    expect(res.body.name).toBe('RavHub');
    expect(res.body.version).toBeDefined();
  });
});
