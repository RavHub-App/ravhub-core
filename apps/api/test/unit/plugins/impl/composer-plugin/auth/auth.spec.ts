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

import { authenticate } from 'src/modules/plugins/impl/composer-plugin/auth/auth';

describe('Composer Plugin Auth (Unit)', () => {
  it('should authenticate user with username', async () => {
    const res = await authenticate({}, { username: 'testuser' });
    expect(res.ok).toBeTruthy();
    expect(res.user.username).toBe('testuser');
  });

  it('should fail authentication without username', async () => {
    const res = await authenticate({}, {});
    expect(res.ok).toBeFalsy();
    expect(res.message).toBe('Missing credentials');
  });
});
