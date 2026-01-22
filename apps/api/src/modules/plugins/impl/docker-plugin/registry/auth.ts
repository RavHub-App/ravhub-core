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
export function checkTokenAllows(
  authHeader: string | undefined,
  name: string,
  action: 'push' | 'pull',
): { allowed: boolean; reason?: string } {
  if (!authHeader) return { allowed: false, reason: 'no auth' };

  const jwt = require('jsonwebtoken');
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    console.error('[SECURITY] JWT_SECRET not configured');
    return { allowed: false, reason: 'server misconfigured' };
  }
  let token: string;

  // Handle Bearer token
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length).trim();
  }
  // Handle Basic auth
  else if (authHeader.startsWith('Basic ')) {
    const credentials = Buffer.from(
      authHeader.slice('Basic '.length).trim(),
      'base64',
    ).toString('utf-8');
    const [username, password] = credentials.split(':', 2);
    if (!password) return { allowed: false, reason: 'invalid basic auth' };

    // Try to decode password as JWT token first (docker login with token as password)
    try {
      jwt.verify(password, secret as any);
      token = password;
    } catch (e) {
      // Password is not a JWT token - treat as regular username:password
      // Basic auth without JWT is not supported - must use JWT tokens
      // keep minimal logging for failed auth attempts
      if (process.env.DEBUG_REGISTRY_AUTH === 'true')
        console.debug('[BASIC AUTH] Rejected - use JWT tokens', {
          username,
          action,
          name,
        });
      return {
        allowed: false,
        reason: 'basic auth not supported, use JWT token',
      };
    }
  } else {
    return { allowed: false, reason: 'invalid auth type' };
  }

  // Validate JWT token
  try {
    const payload = jwt.verify(token, secret as any);
    const access = payload.access || payload.scopes || payload.scope;
    // token inspection is sensitive — only output in debug mode
    if (process.env.DEBUG_REGISTRY_AUTH === 'true')
      console.debug('[TOKEN CHECK]', { name, action, access });
    if (!access) return { allowed: false, reason: 'no scopes' };
    for (const a of access) {
      if (a.type === 'repository' && a.name === name) {
        if (Array.isArray(a.actions) && a.actions.includes(action)) {
          return { allowed: true };
        }
      }
    }
    return { allowed: false, reason: 'insufficient scope' };
  } catch (e: any) {
    // invalid token — warn but avoid noisy stack traces
    console.warn('[TOKEN CHECK ERROR]', e.message);
    return { allowed: false, reason: 'invalid token' };
  }
}

/**
 * Build WWW-Authenticate challenge header
 */
export function buildChallengeHeader(
  name: string,
  action: string,
  host?: string,
  port?: number,
): string {
  const proto = process.env.REGISTRY_PROTOCOL || 'http';
  const h = host || process.env.REGISTRY_HOST || 'localhost';
  const p = port || 5000;
  const realm = `${proto}://${h}:${p}/v2/token`;
  const service = `${h}:${p}`;
  const scope = `repository:${name}:${action}`;

  const header = `Bearer realm="${realm}",service="${service}",scope="${scope}"`;
  return header;
}
