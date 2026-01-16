/**
 * Utility functions for Docker registry server
 */

/**
 * Read the full body from an HTTP request
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
