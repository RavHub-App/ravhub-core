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

export async function authenticate(repo: any, creds: any) {
  if (creds?.name || creds?.username) {
    const username = creds.name || creds.username;
    return {
      ok: true,
      user: { username, displayName: username },
    };
  }
  return { ok: false, message: 'Missing credentials' };
}
