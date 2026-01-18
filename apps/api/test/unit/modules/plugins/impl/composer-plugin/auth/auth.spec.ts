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

describe('ComposerPlugin Auth', () => {
  it('should authenticate with username', async () => {
    const creds = { username: 'testuser' };
    const result = await authenticate({}, creds);

    expect(result.ok).toBe(true);
    expect(result.user).toEqual({
      username: 'testuser',
      displayName: 'testuser',
    });
  });

  it('should fail without username', async () => {
    const result = await authenticate({}, {});
    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing credentials');
  });

  it('should fail with null creds', async () => {
    const result = await authenticate({}, null);
    expect(result.ok).toBe(false);
  });
});
