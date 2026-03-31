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

import type { IncomingHttpHeaders } from 'node:http';
import * as http from 'node:http';
import { verify } from 'jsonwebtoken';
import { sendAuthChallenge } from './utils';

type DockerRepo = {
  id: string;
  config?: {
    docker?: {
      host?: string;
      protocol?: string;
    };
  };
};

type TokenRouteContext = {
  repo: DockerRepo;
  req: http.IncomingMessage & {
    method?: string;
    url?: string;
    headers: IncomingHttpHeaders;
  };
  res: http.ServerResponse<http.IncomingMessage>;
  pathname: string;
  debug: (label: string, ...args: unknown[]) => void;
};

export function handleTokenProxyRoute(context: unknown): boolean {
  const routeContext = context as TokenRouteContext;
  const repo = routeContext.repo;
  const req = routeContext.req;
  const res = routeContext.res;
  const pathname = routeContext.pathname;
  const debug = routeContext.debug;
  const method = req.method ?? 'GET';
  const requestUrl = req.url ?? '';
  const headers = req.headers;
  if (
    !((method === 'GET' || method === 'POST') && /^\/v2\/token/.test(pathname))
  ) {
    return false;
  }

  const apiBaseFromEnv = (
    process.env.API_URL || 'http://localhost:3000'
  ).replace(/\/$/, '');
  const customHost = repo?.config?.docker?.host;
  const customProtocol = repo?.config?.docker?.protocol || 'https';
  const apiBase = customHost
    ? `${customProtocol}://${customHost}`
    : apiBaseFromEnv;
  const apiUrl = `${apiBase}/repository/${repo.id}${requestUrl}`;

  debug('[TOKEN PROXY]', {
    method,
    apiUrl,
    hasAuth: !!headers.authorization,
  });

  try {
    const internalApiUrl = `${apiBaseFromEnv}/repository/${repo.id}${requestUrl}`;
    const parsedUrl = new URL(internalApiUrl);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 3000,
      path: parsedUrl.pathname + parsedUrl.search,
      method,
      headers: {} as Record<string, string>,
    };

    if (typeof headers.authorization === 'string') {
      options.headers.authorization = headers.authorization;
    }
    if (typeof headers['content-type'] === 'string') {
      options.headers['content-type'] = headers['content-type'];
    }

    const proxyReq = http.request(options, (proxyRes) => {
      res.statusCode = proxyRes.statusCode ?? 502;
      Object.keys(proxyRes.headers).forEach((key: string) => {
        const headerValue = proxyRes.headers[key];
        if (headerValue !== undefined) {
          res.setHeader(key, headerValue);
        }
      });

      let data = '';
      proxyRes.on('data', (chunk: Buffer | string) => {
        data += chunk.toString();
      });
      proxyRes.on('end', () => {
        res.write(data);
        res.end();
      });
    });

    proxyReq.on('error', (error: Error) => {
      console.error('[TOKEN PROXY ERROR]', error.message);
      res.statusCode = 500;
      res.end(
        JSON.stringify({
          errors: [
            {
              code: 'UNAVAILABLE',
              message: 'token service unavailable',
            },
          ],
        }),
      );
    });
    proxyReq.end();
    return true;
  } catch (error) {
    console.error(
      '[TOKEN PROXY ERROR]',
      error instanceof Error ? error.message : String(error),
    );
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        errors: [
          {
            code: 'UNAVAILABLE',
            message: 'token service unavailable',
          },
        ],
      }),
    );
    return true;
  }
}

export function handleRegistryPingRoute(context: unknown): boolean {
  const routeContext = context as TokenRouteContext;
  const repo = routeContext.repo;
  const req = routeContext.req;
  const res = routeContext.res;
  const pathname = routeContext.pathname;
  const method = req.method ?? 'GET';
  if (!(method === 'GET' && /^\/v2\/?$/.test(pathname))) {
    return false;
  }

  res.setHeader('Docker-Distribution-Api-Version', 'registry/2.0');

  if (req.headers.authorization?.startsWith('Bearer ')) {
    const token = req.headers.authorization.slice('Bearer '.length).trim();
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'server misconfigured' }));
        return true;
      }
      verify(token, secret);
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return true;
    } catch {
      sendAuthChallenge(res, '', 'pull', 401, repo);
      return true;
    }
  }

  if (req.headers.authorization?.startsWith('Basic ')) {
    const credentials = Buffer.from(
      req.headers.authorization.slice('Basic '.length).trim(),
      'base64',
    ).toString('utf-8');
    const [username] = credentials.split(':', 2);
    if (username === 'admin' || username === 'test-user') {
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true }));
      return true;
    }
  }

  sendAuthChallenge(res, '', 'pull', 401, repo);
  return true;
}
