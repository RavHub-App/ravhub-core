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
  // allow callers to override the timeout and stream threshold if desired
  timeoutMs?: number;
  streamThresholdBytes?: number;
  // if true, return raw Buffer even for JSON/text content
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
  // configurable timeout (ms)
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
    // Support auth at multiple locations: config.docker.auth, config.auth, or auth
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

    // retry loop with simple exponential backoff
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
        // DEBUG: log outgoing request headers to help test diagnosis

        console.log('[PROXY_FETCH_HELPER] fetching', { targetUrl, headers, method: opts?.method || 'GET' });
        const r = await fetch(targetUrl, {
          method: opts?.method || 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow', // Explicitly follow redirects
        });

        if (r.status >= 400 && r.url !== targetUrl && headers['Authorization']) {
          const originalHost = new URL(targetUrl).hostname;
          const finalHost = new URL(r.url).hostname;
          if (originalHost !== finalHost) {
            console.warn('[PROXY_FETCH_HELPER] Redirected with Auth header and got error. Retrying without Auth...', { finalHost, status: r.status });
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
        // exponential backoff (jitter)
        const backoff = Math.min(2000 * Math.pow(2, attempt), 30_000);
        await new Promise((r) =>
          setTimeout(r, backoff + Math.floor(Math.random() * 250)),
        );
      }
    }

    if (!res && lastErr) {
      // Normalize unknown error to Error when throwing
      if (lastErr instanceof Error) throw lastErr;
      throw new Error(String(lastErr));
    }

    if (!res) {
      return { ok: false, status: 500, body: { message: 'no response' } };
    }

    // Handle Docker/OCI registry authentication challenge (401 with Www-Authenticate header)
    if (res.status === 401) {
      const wwwAuth = res.headers.get('www-authenticate');
      console.log('[PROXY_FETCH_HELPER] 401 Challenge received', { wwwAuth });
      if (wwwAuth && wwwAuth.toLowerCase().startsWith('bearer')) {
        try {
          // Parse the WWW-Authenticate header to get token service URL
          const realmMatch = wwwAuth.match(/realm="([^"]+)"/);
          const serviceMatch = wwwAuth.match(/service="([^"]+)"/);
          const scopeMatch = wwwAuth.match(/scope="([^"]+)"/);

          if (realmMatch) {
            const tokenUrl = new URL(realmMatch[1]);
            if (serviceMatch)
              tokenUrl.searchParams.set('service', serviceMatch[1]);
            if (scopeMatch) tokenUrl.searchParams.set('scope', scopeMatch[1]);

            console.log(
              '[PROXY_FETCH_HELPER] Registry auth challenge, fetching token from:',
              tokenUrl.toString(),
            );

            // Fetch token (anonymous for public images, or with credentials if configured)
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

            // CONSUME the 401 body to avoid socket hangs
            try { await res.arrayBuffer(); } catch (e) { }

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
                console.log(
                  '[PROXY_FETCH_HELPER] Got registry token, retrying original request',
                );
                // Retry original request with the token
                headers['Authorization'] = `Bearer ${token}`;
                res = await fetchOnce();
                console.log('[PROXY_FETCH_HELPER] retry result status:', res.status);
              }
            } else {
              console.error('[PROXY_FETCH_HELPER] token fetch failed:', tokenRes.status);
            }
          }
        } catch (err) {
          console.error(
            '[PROXY_FETCH_HELPER] Failed to handle Docker Hub auth:',
            err,
          );
          // Continue with original 401 response
        }
      }
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    // copy response headers back to caller (useful for some proxies)
    const respHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      // Filter out headers that might conflict with the new response
      if (!['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(k.toLowerCase())) {
        respHeaders[k] = v;
      }
    });

    // handle common response types: json, text, binary
    let body: unknown;
    const wantStream = Boolean(opts?.stream);
    // if content-length large and not requesting full body, return stream
    const contentLengthHeader = res.headers.get('content-length');
    const contentLength = contentLengthHeader
      ? Number(contentLengthHeader)
      : NaN;
    const streamThreshold = Number(
      opts?.streamThresholdBytes ??
      Number(process.env.PROXY_FETCH_STREAM_THRESHOLD_BYTES || 1_000_000),
    ); // default 1MB

    if (
      !Number.isNaN(contentLength) &&
      contentLength > streamThreshold &&
      !wantStream
    ) {
      // fallback: still read whole body by default, but warn (keep backward compat)
      // for large content, we can choose to return a stream if caller requested it
    }

    if (
      wantStream ||
      (!Number.isNaN(contentLength) &&
        contentLength > streamThreshold &&
        opts?.stream)
    ) {
      // return the underlying Node.js stream where available
      // convert WHATWG ReadableStream (fetch) to Node Readable if needed
      const bodyStream: NodeJS.ReadableStream | ReadableStream | null =
        // node-fetch / native fetch web stream

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
      return { ok: res.ok, status: res.status, body: Buffer.from(buf), headers: respHeaders, message: (body as any)?.message };
    }

    const isDocker = (headers['Accept'] || '').includes('application/vnd.docker') || targetUrl.includes('/v2/');

    if (!isDocker && (ct.includes('application/json') || ct.includes('+json'))) {
      body = await res.json();
      console.log('[PROXY_FETCH_HELPER] Parsed JSON body for', targetUrl);
    } else if (
      ct.startsWith('text/') ||
      ct.includes('xml') ||
      ct.includes('html') ||
      ct.includes('javascript')
    ) {
      body = await res.text();
      console.log('[PROXY_FETCH_HELPER] Parsed text body for', targetUrl, (body as string).length, 'bytes');
    } else {
      // binary or unknown: return Buffer
      console.log('[PROXY_FETCH_HELPER] Downloading binary body for', targetUrl, 'type:', ct);
      const buf = await res.arrayBuffer();
      body = Buffer.from(buf);
      console.log('[PROXY_FETCH_HELPER] Downloaded binary body for', targetUrl, (body as Buffer).length, 'bytes');
    }

    return { ok: res.ok, status: res.status, body, headers: respHeaders, message: (body as any)?.message };
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
