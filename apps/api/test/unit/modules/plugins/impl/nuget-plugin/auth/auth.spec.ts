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

import { authenticate } from 'src/modules/plugins/impl/nuget-plugin/auth/auth';

describe('NugetPlugin Auth', () => {
  it('should authenticate with username', async () => {
    const result = await authenticate({} as any, { username: 'alice' });

    expect(result.ok).toBe(true);
    expect(result.user?.username).toBe('alice');
  });

  it('should fail without username', async () => {
    const result = await authenticate({} as any, {});

    expect(result.ok).toBe(false);
    expect(result.message).toBe('Missing credentials');
  });
});
