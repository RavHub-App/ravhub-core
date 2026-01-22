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
export function readBody(req: any): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const bufs: any[] = [];
    req.on('data', (d: any) => bufs.push(d));
    req.on('end', () => resolve(Buffer.concat(bufs)));
    req.on('error', reject);
  });
}

/**
 * Send an authentication challenge response
 */
export function sendAuthChallenge(
  res: any,
  name: string,
  action: string,
  statusCode: number = 401,
): void {
  // Build challenge header
  const host = process.env.REGISTRY_HOST || 'localhost';
  const proto = process.env.REGISTRY_PROTOCOL || 'http';
  // Get port from the request (since each repo has its own port)
  const port = res.socket?.localPort || 5000;
  const service = `${host}:${port}`;
  const realm = `${proto}://${host}:${port}/v2/token`;
  const challengeHeader = `Bearer realm="${realm}",service="${service}",scope="repository:${name}:${action}"`;

  res.setHeader('WWW-Authenticate', challengeHeader);
  res.setHeader('Docker-Distribution-Api-Version', 'registry/2.0');
  res.statusCode = statusCode;
  res.end(
    JSON.stringify({
      errors: [
        {
          code: statusCode === 401 ? 'UNAUTHORIZED' : 'DENIED',
          message: 'authentication required',
        },
      ],
    }),
  );
}
