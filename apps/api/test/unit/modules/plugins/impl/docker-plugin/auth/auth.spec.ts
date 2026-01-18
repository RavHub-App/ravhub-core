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
  issueToken,
  authenticate,
  generateToken,
} from 'src/modules/plugins/impl/docker-plugin/auth/auth';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(
    (payload, _secret) =>
      `jwt.${Buffer.from(JSON.stringify(payload)).toString('base64')}`,
  ),
}));

describe('DockerPlugin Auth', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'test-secret' };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('issueToken', () => {
    it('should issue a random token', async () => {
      const result = await issueToken({}, {});

      expect(result.ok).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token).toMatch(/^tok-/);
    });

    it('should issue different tokens each time', async () => {
      const result1 = await issueToken({}, {});
      const result2 = await issueToken({}, {});

      expect(result1.token).not.toBe(result2.token);
    });
  });

  describe('authenticate', () => {
    it('should authenticate with valid credentials', async () => {
      const result = await authenticate({}, { username: 'testuser' });

      expect(result.ok).toBe(true);
      expect(result.user?.username).toBe('testuser');
      expect(result.user?.displayName).toBe('testuser');
    });

    it('should reject missing credentials', async () => {
      const result = await authenticate({}, {});

      expect(result.ok).toBe(false);
      expect(result.message).toBe('missing credentials');
    });

    it('should reject null credentials', async () => {
      const result = await authenticate({}, null);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('missing credentials');
    });

    it('should reject credentials without username', async () => {
      const result = await authenticate({}, { password: 'test' });

      expect(result.ok).toBe(false);
    });
  });

  describe('generateToken', () => {
    it('should generate JWT token with username', async () => {
      const result = await generateToken({}, { username: 'testuser' });

      expect(result.ok).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token).toContain('jwt.');
    });

    it('should generate token for anonymous user', async () => {
      const result = await generateToken({}, null);

      expect(result.ok).toBe(true);
      expect(result.token).toBeDefined();
    });

    it('should parse repository scopes', async () => {
      const jwt = require('jsonwebtoken');
      const result = await generateToken(
        {},
        { username: 'testuser' },
        { scopes: ['repository:myimage:pull', 'repository:other:push,pull'] },
      );

      expect(result.ok).toBe(true);
      expect(jwt.sign).toHaveBeenCalledWith(
        expect.objectContaining({
          sub: 'testuser',
          access: expect.arrayContaining([
            expect.objectContaining({
              type: 'repository',
              name: 'myimage',
              actions: ['pull'],
            }),
          ]),
        }),
        'test-secret',
      );
    });

    it('should handle multiple actions in scope', async () => {
      const jwt = require('jsonwebtoken');
      const result = await generateToken(
        {},
        { username: 'testuser' },
        { scopes: ['repository:image:push,pull'] },
      );

      expect(result.ok).toBe(true);
      const call = (jwt.sign as jest.Mock).mock.calls[0][0];
      expect(call.access[0].actions).toEqual(['push', 'pull']);
    });

    it('should fail without JWT_SECRET', async () => {
      delete process.env.JWT_SECRET;

      const result = await generateToken({}, { username: 'test' });

      expect(result.ok).toBe(false);
      expect(result.message).toBe('server misconfigured');
    });

    it('should include expiration in token', async () => {
      const jwt = require('jsonwebtoken');
      const beforeTime = Math.floor(Date.now() / 1000);

      await generateToken({}, { username: 'test' });

      const call = (jwt.sign as jest.Mock).mock.calls[0][0];
      expect(call.exp).toBeGreaterThan(beforeTime);
      expect(call.exp).toBeLessThanOrEqual(beforeTime + 3600);
    });

    it('should handle complex image names with colons', async () => {
      const jwt = require('jsonwebtoken');
      const result = await generateToken(
        {},
        { username: 'test' },
        { scopes: ['repository:registry.io/namespace/image:pull'] },
      );

      expect(result.ok).toBe(true);
      const call = (jwt.sign as jest.Mock).mock.calls[0][0];
      expect(call.access[0].name).toBe('registry.io/namespace/image');
    });
  });
});
