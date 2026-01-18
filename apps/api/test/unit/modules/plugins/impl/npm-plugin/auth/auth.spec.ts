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

import { authenticate } from 'src/modules/plugins/impl/npm-plugin/auth/auth';

describe('NpmPlugin Auth', () => {
  it('should authenticate with username', async () => {
    const result = await authenticate({}, { username: 'testuser' });
    expect(result.ok).toBe(true);
    expect(result.user?.username).toBe('testuser');
  });

  it('should authenticate with name field', async () => {
    const result = await authenticate({}, { name: 'testuser' });
    expect(result.ok).toBe(true);
    expect(result.user?.username).toBe('testuser');
  });

  it('should fail without credentials', async () => {
    const result = await authenticate({}, {});
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing credentials');
  });
});
