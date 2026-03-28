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
 * Helper to build a public URL for a given path, respecting custom repo host/protocol.
 * If no custom host is defined, it returns a relative path (starting with /)
 * so that the Docker client uses the host it's already talking to.
 */
export function buildPublicUrl(repo: any, path: string, res?: any): string {
  const customHost = repo?.config?.docker?.host;
  const customProto = repo?.config?.docker?.protocol;

  if (customHost) {
    const proto = customProto || 'https';
    return `${proto}://${customHost}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  // If no custom host, return relative path. 
  // Docker clients handle relative Location headers by prepending the current host:port.
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Send an authentication challenge response
 */
export function sendAuthChallenge(
  res: any,
  name: string,
  action: string,
  statusCode: number = 401,
  repo?: any,
): void {
  // Build challenge header
  const customHost = repo?.config?.docker?.host;
  const customProto = repo?.config?.docker?.protocol;

  const host = customHost || process.env.REGISTRY_HOST || 'localhost';
  const proto = customProto || process.env.REGISTRY_PROTOCOL || 'http';

  // Get port from the request (since each repo has its own port)
  const port = res.socket?.localPort || 5000;

  // service is usually the host:port that docker sees
  const service = customHost ? host : `${host}:${port}`;
  // realm must be the full token URL. If a custom host (reverse proxy) is used, we use it without port
  const realm = customHost ? `${proto}://${host}/v2/token` : `${proto}://${host === '0.0.0.0' ? 'localhost' : host}:${port}/v2/token`;

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
