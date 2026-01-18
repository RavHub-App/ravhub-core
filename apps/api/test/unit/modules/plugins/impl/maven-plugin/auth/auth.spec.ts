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

import { authenticate } from 'src/modules/plugins/impl/maven-plugin/auth/auth';

describe('MavenPlugin Auth', () => {
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
      expect(result.message).toBe('Missing credentials');
    });

    it('should reject null credentials', async () => {
      const result = await authenticate({}, null);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Missing credentials');
    });

    it('should reject credentials without username', async () => {
      const result = await authenticate({}, { password: 'test' });

      expect(result.ok).toBe(false);
    });

    it('should handle empty username', async () => {
      const result = await authenticate({}, { username: '' });

      expect(result.ok).toBe(false);
    });
  });
});
