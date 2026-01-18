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

import { authenticate } from 'src/modules/plugins/impl/helm-plugin/auth/auth';

describe('HelmPlugin Auth', () => {
  it('should authenticate with username', async () => {
    const result = await authenticate({}, { username: 'testuser' });

    expect(result.ok).toBe(true);
    expect(result.user?.name).toBe('testuser');
  });

  it('should allow anonymous access', async () => {
    const result = await authenticate({}, {});

    expect(result.ok).toBe(true);
  });

  it('should handle null credentials', async () => {
    const result = await authenticate({}, null);

    expect(result.ok).toBe(true);
  });
});
