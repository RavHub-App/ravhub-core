/*
 * Copyright (C) 2026 RavHub Team
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

import {
  authenticate,
  issueToken,
  generateToken,
} from 'src/modules/plugins/impl/docker-plugin/auth/auth';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(() => 'signed-token'),
}));

describe('Docker Plugin Auth (Unit)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv, JWT_SECRET: 'test' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should issue token', async () => {
    const t = await issueToken({}, {});
    expect(t.ok).toBeTruthy();
    expect(t.token).toBeDefined();
  });

  it('should authenticate user', async () => {
    const res = await authenticate({}, { username: 'u' });
    expect(res.ok).toBeTruthy();
    expect(res.user.username).toBe('u');
  });

  it('should fail auth without credentials', async () => {
    const res = await authenticate({}, {});
    expect(res.ok).toBeFalsy();
  });

  it('should generate JWT token', async () => {
    const res = await generateToken(
      {},
      { username: 'u' },
      { scopes: ['repository:foo:pull'] },
    );
    expect(res.ok).toBeTruthy();
    expect(res.token).toBe('signed-token');
  });

  it('should fail token generation if secret missing', async () => {
    delete process.env.JWT_SECRET;
    const res = await generateToken({}, {});
    expect(res.ok).toBeFalsy();
    expect(res.message).toMatch(/misconfigured/);
  });
});
