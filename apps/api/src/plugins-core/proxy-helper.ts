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

import { Logger } from '@nestjs/common';

type BasicAuth = { type: 'basic'; username: string; password?: string };
type BearerAuth = { type: 'bearer'; token: string };
type GenericAuth = {
  type?: string;
  token?: string;
  username?: string;
  password?: string;
};

type RepoLike = {
  id?: string;
  name?: string;
  target?: string;
  config?: {
    target?: string;
    url?: string;
    registry?: string;
    upstream?: string;
    indexUrl?: string;
    proxyUrl?: string;
    auth?: BasicAuth | BearerAuth | GenericAuth;
    docker?: {
      auth?: BasicAuth | BearerAuth | GenericAuth;
      upstream?: string;
    };
    [key: string]: any;
  };
  auth?: BasicAuth | BearerAuth | GenericAuth | null;
};

export type ProxyFetchOptions = {
  method?: string;
  stream?: boolean;
  headers?: Record<string, string>;
  maxRetries?: number;
  timeoutMs?: number;
  streamThresholdBytes?: number;
  buffer?: boolean;
};
export type ProxyFetchResult<T = unknown> =
  | {
      ok: true;
      status: number;
      headers: Record<string, string>;
      body?: T;
      skipCache?: boolean;
      message?: string;
    }
  | {
      ok: false;
      status: number;
      headers?: Record<string, string>;
      body?: unknown;
      skipCache?: boolean;
      message?: string;
    }
  | {
      ok: boolean;
      status: number;
      headers?: Record<string, string>;
      stream?: NodeJS.ReadableStream | ReadableStream | null;
      skipCache?: boolean;
      message?: string;
    };

export async function proxyFetchWithAuth(
  repo: RepoLike,
  url: string,
  opts?: ProxyFetchOptions,
): Promise<ProxyFetchResult> {
  const logger = new Logger('ProxyFetchHelper');

  const defaultTimeout = Number(process.env.PROXY_FETCH_TIMEOUT_MS || 30_000);
  const maxRetriesDefault = Number(process.env.PROXY_FETCH_RETRIES || 2);
  try {
    const config = repo?.config || {};
    const target = config.proxyUrl || config.url || config.upstream || '';

    if (!target && !/^https?:\/\//.test(url)) {
      return {
        ok: false,
        status: 400,
        body: { message: 'missing upstream target' },
      };
    }

    const targetUrl = url.match(/^https?:\/\//)
      ? url
      : `${target.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;

    const headers: Record<string, string> = {
      'User-Agent': 'RavHub-Proxy/1.0',
      ...(opts?.headers || {}),
    };

    const auth =
      repo?.config?.docker?.auth ?? repo?.config?.auth ?? repo?.auth ?? null;
    if (auth) {
      if (
        (auth as BearerAuth).type === 'bearer' ||
        ((auth as any).token && !(auth as any).username)
      ) {
        headers['Authorization'] = `Bearer ${(auth as any).token}`;
      } else if (
        (auth as BasicAuth).type === 'basic' ||
        (auth as any).username
      ) {
        const token = Buffer.from(
          `${(auth as any).username}:${(auth as any).password || ''}`,
        ).toString('base64');
        headers['Authorization'] = `Basic ${token}`;
      }
    }

    const retries = opts?.maxRetries ?? maxRetriesDefault;
    let attempt = 0;
    let lastErr: unknown = null;
    let res: Response | null = null;

    const fetchOnce = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        opts?.timeoutMs ?? defaultTimeout,
      );
      try {
        logger.debug(`Fetching ${targetUrl}`, {
          headers,
          method: opts?.method || 'GET',
        });
        const r = await fetch(targetUrl, {
          method: opts?.method || 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow',
        });

        if (
          r.status >= 400 &&
          r.url !== targetUrl &&
          headers['Authorization']
        ) {
          const originalHost = new URL(targetUrl).hostname;
          const finalHost = new URL(r.url).hostname;
          if (originalHost !== finalHost) {
            logger.warn(
              `Redirected with Auth header and got error. Retrying without Auth... finalHost=${finalHost}, status=${r.status}`,
            );
            const headersNoAuth = { ...headers };
            delete headersNoAuth['Authorization'];
            return fetch(r.url, {
              method: opts?.method || 'GET',
              headers: headersNoAuth,
              signal: controller.signal,
              redirect: 'follow',
            });
          }
        }
        return r;
      } finally {
        clearTimeout(timeout);
      }
    };

    while (attempt <= retries) {
      try {
        res = await fetchOnce();
        lastErr = null;
        break;
      } catch (err: unknown) {
        lastErr = err;
        attempt += 1;

        const backoff = Math.min(2000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) =>
          setTimeout(r, backoff + Math.floor(Math.random() * 250)),
        );
      }
    }

    if (!res && lastErr) {
      if (lastErr instanceof Error) throw lastErr;
      throw new Error(String(lastErr));
    }

    if (!res) {
      return { ok: false, status: 500, body: { message: 'no response' } };
    }

    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate');
      logger.debug(`401 Challenge received: ${wwwAuth}`);
      if (wwwAuth && wwwAuth.toLowerCase().startsWith('bearer')) {
        try {
          const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
          const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
          const scopeMatch = wwwAuth.match(/scope="([^"]+)"/);

          if (realmMatch) {
            const tokenUrl = new URL(realmMatch[1]);
            if (serviceMatch)
              tokenUrl.searchParams.set('service', serviceMatch[1]);
            if (scopeMatch) tokenUrl.searchParams.set('scope', scopeMatch[1]);

            logger.debug(
              `Registry auth challenge, fetching token from: ${tokenUrl.toString()}`,
            );

            const tokenHeaders: Record<string, string> = {};
            if (
              auth &&
              (auth as BasicAuth).type === 'basic' &&
              (auth as BasicAuth).username
            ) {
              const token = Buffer.from(
                `${(auth as BasicAuth).username}:${(auth as BasicAuth).password || ''}`,
              ).toString('base64');
              tokenHeaders['Authorization'] = `Basic ${token}`;
            }

            try {
              await res.arrayBuffer();
            } catch (e) {}

            const tokenRes = await fetch(tokenUrl.toString(), {
              headers: tokenHeaders,
            });
            if (tokenRes.ok) {
              const tokenData = (await tokenRes.json()) as {
                token?: string;
                access_token?: string;
              };
              const token = tokenData.token || tokenData.access_token;

              if (token) {
                logger.debug('Got registry token, retrying original request');
                headers['Authorization'] = `Bearer ${token}`;
                res = await fetchOnce();
                logger.debug(`retry result status: ${res.status}`);
              }
            } else {
              logger.error(`token fetch failed: ${tokenRes.status}`);
            }
          }
        } catch (err) {
          logger.error(`Failed to handle Docker Hub auth: ${err}`);
        }
      }
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();

    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      if (
        ![
          'content-length',
          'content-encoding',
          'transfer-encoding',
          'connection',
        ].includes(k.toLowerCase())
      ) {
        respHeaders[k] = v;
      }
    });

    let body: unknown;
    const wantStream = Boolean(opts?.stream);

    const contentLengthHeader = res.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : NaN;
    const streamThreshold = Number(
      opts?.streamThresholdBytes ??
        Number(process.env.PROXY_FETCH_STREAM_THRESHOLD_BYTES || 1_000_000),
    );

    if (
      !Number.isNaN(contentLength) &&
      contentLength > streamThreshold &&
      !wantStream
    ) {
    }

    if (
      wantStream ||
      (!Number.isNaN(contentLength) &&
        contentLength > streamThreshold &&
        opts?.stream)
    ) {
      const bodyStream: NodeJS.ReadableStream | ReadableStream | null =
        ((res as any).body as NodeJS.ReadableStream | ReadableStream | null) ||
        null;
      return {
        ok: res.ok,
        status: res.status,
        headers: respHeaders,
        stream: bodyStream,
      };
    }

    if (opts?.buffer) {
      const buf = await res.arrayBuffer();
      return {
        ok: res.ok,
        status: res.status,
        body: Buffer.from(buf),
        headers: respHeaders,
        message: (body as any)?.message,
      };
    }

    const isDocker =
      (headers['Accept'] || '').includes('application/vnd.docker') ||
      targetUrl.includes('/v2/');

    if (
      !isDocker &&
      (ct.includes('application/json') || ct.includes('+json'))
    ) {
      body = await res.json();
      logger.debug(`Parsed JSON body for ${targetUrl}`);
    } else if (
      ct.startsWith('text/') ||
      ct.includes('xml') ||
      ct.includes('html') ||
      ct.includes('javascript')
    ) {
      body = await res.text();
      logger.debug(
        `Parsed text body for ${targetUrl} (${(body as string).length} bytes)`,
      );
    } else {
      logger.debug(`Downloading binary body for ${targetUrl} type: ${ct}`);
      const buf = await res.arrayBuffer();
      body = Buffer.from(buf);
      logger.debug(
        `Downloaded binary body for ${targetUrl} (${(body as Buffer).length} bytes)`,
      );
    }

    return {
      ok: res.ok,
      status: res.status,
      body,
      headers: respHeaders,
      message: (body as any)?.message,
    };
  } catch (err: any) {
    const castErr = err as unknown;
    const msg =
      (castErr as any)?.name === 'AbortError'
        ? 'timeout'
        : (castErr as any)?.message || 'unknown error';
    return { ok: false, status: 500, body: { message: msg }, message: msg };
  }
}

export default proxyFetchWithAuth;
