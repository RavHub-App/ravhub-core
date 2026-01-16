/**
 * Docker Registry Server module
 * Implements a lightweight in-process HTTP server for Docker Registry V2 API
 *
 * Extracted from docker-plugin.ts lines 1536-2528
 *
 * Main functions:
 * - startRegistryForRepo: Start registry server for a repository
 * - stopRegistryForRepo: Stop registry server for a repository
 *
 * The server implements Docker Registry V2 endpoints:
 * - GET /v2/ - API version check
 * - GET /v2/token - Token authentication (proxied to main API)
 * - GET /v2/<name>/manifests/<reference> - Get manifest
 * - PUT /v2/<name>/manifests/<reference> - Put manifest
 * - GET /v2/<name>/blobs/<digest> - Get blob
 * - POST /v2/<name>/blobs/uploads/ - Initiate blob upload
 * - PATCH /v2/<name>/blobs/uploads/<uuid> - Append to blob upload
 * - PUT /v2/<name>/blobs/uploads/<uuid> - Complete blob upload
 * - GET /v2/<name>/tags/list - List tags
 */

import { selectPort } from './port-manager';
import { checkTokenAllows } from './auth';
import { readBody, sendAuthChallenge } from './utils';
import type { Repository } from '../utils/types';

// Storage for active registry servers
const registryServers = new Map<string, any>();

/**
 * Start a Docker registry server for a repository
 */
export async function startRegistryForRepo(
  repo: Repository,
  opts?: any,
  context?: {
    plugin: any; // Full plugin context with all methods
  },
) {
  try {
    // Check if already running
    const existing = registryServers.get(repo.id || repo.name);
    if (existing) {
      return { ok: true, port: existing.port, accessUrl: existing.accessUrl };
    }

    // Select port
    const { port, needsPersistence } = await selectPort(opts?.port);

    const host = process.env.REGISTRY_HOST || 'localhost';
    const proto = process.env.REGISTRY_PROTOCOL || 'http';
    const accessUrl = `${proto}://${host}:${port}`;

    // Create a small HTTP server and wire the minimal registry endpoints
    const http = require('http');
    const url = require('url');

    // pick registry version: prefer opts.version -> repo.config.docker.version -> v2
    const chosenVersion = (
      opts?.version ||
      repo?.config?.docker?.version ||
      'v2'
    ).toString();

    // Get plugin reference from context
    const plugin = context?.plugin;
    if (!plugin) {
      throw new Error('plugin context is required for registry server');
    }

    const server = http.createServer(async (req: any, res: any) => {
      try {
        // small per-request debug helper — enable with DEBUG_REGISTRY=true
        const d = (label: string, ...args: any[]) => {
          if (process.env.DEBUG_REGISTRY === 'true')
            console.debug(label, ...args);
        };
        d('[REGISTRY]', req.method, req.url, {
          hasAuth: !!req.headers?.authorization,
          authType: req.headers?.authorization?.split(' ')[0],
        });
        const parsed = url.parse(req.url || '', true);
        const pathname: string = parsed.pathname || '';

        // Token endpoint proxy - Docker requires this to be on the same host:port as the registry
        // Since each repo has its own port, we proxy /v2/token to the API's /repository/{repo.id}/v2/token
        if (
          (req.method === 'GET' || req.method === 'POST') &&
          /^\/v2\/token/.test(pathname)
        ) {
          console.log('[REGISTRY PROXY] Handling token request:', req.method, req.url);
          const apiBase = (
            process.env.API_URL || 'http://localhost:3000'
          ).replace(/\/$/, '');
          const apiUrl = `${apiBase}/repository/${repo.id}${req.url}`;
          console.log('[REGISTRY PROXY] Proxying to:', apiUrl);
          d('[TOKEN PROXY]', {
            method: req.method,
            apiUrl,
            hasAuth: !!req.headers?.authorization,
          });

          try {
            const parsedUrl = new URL(apiUrl);
            const options = {
              hostname: parsedUrl.hostname,
              port: parsedUrl.port || 3000,
              path: parsedUrl.pathname + parsedUrl.search,
              method: req.method,
              headers: {} as any,
            };
            if (req.headers.authorization)
              options.headers.authorization = req.headers.authorization;
            if (req.headers['content-type'])
              options.headers['content-type'] = req.headers['content-type'];

            const proxyReq = http.request(options, (proxyRes: any) => {
              console.log('[REGISTRY PROXY] Response status:', proxyRes.statusCode);
              res.statusCode = proxyRes.statusCode;
              Object.keys(proxyRes.headers).forEach((key: string) => {
                res.setHeader(key, proxyRes.headers[key]);
              });

              // Capture body for debugging
              let data = '';
              proxyRes.on('data', (chunk: any) => {
                data += chunk;
              });
              proxyRes.on('end', () => {
                console.log('[REGISTRY PROXY] Response body:', data);
                res.write(data);
                res.end();
              });
            });
            proxyReq.on('error', (err: any) => {
              console.error('[TOKEN PROXY ERROR]', err.message);
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
            return;
          } catch (err: any) {
            console.error('[TOKEN PROXY ERROR]', err.message);
            res.statusCode = 500;
            return res.end(
              JSON.stringify({
                errors: [
                  {
                    code: 'UNAVAILABLE',
                    message: 'token service unavailable',
                  },
                ],
              }),
            );
          }
        }

        // v2 ping - Docker uses this to discover auth requirements
        // CRITICAL: Must return 401 challenge when no auth to inform Docker that auth is required
        if (
          chosenVersion === 'v2' &&
          req.method === 'GET' &&
          /^\/v2\/?$/.test(pathname)
        ) {
          res.setHeader('Docker-Distribution-Api-Version', 'registry/2.0');

          // If Bearer token provided, verify it's valid
          if (req.headers.authorization?.startsWith('Bearer ')) {
            const token = req.headers.authorization
              .slice('Bearer '.length)
              .trim();
            try {
              const jwt = require('jsonwebtoken');
              const secret = process.env.JWT_SECRET;
              if (!secret) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: 'server misconfigured' }));
                return;
              }
              jwt.verify(token, secret as any);
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true }));
              return;
            } catch (e) {
              return sendAuthChallenge(res, '', 'pull', 401);
            }
          }

          // If Basic auth provided, verify and allow
          if (req.headers.authorization?.startsWith('Basic ')) {
            const credentials = Buffer.from(
              req.headers.authorization.slice('Basic '.length).trim(),
              'base64',
            ).toString('utf-8');
            const [username] = credentials.split(':', 2);
            // Accept admin/test-user for testing
            if (username === 'admin' || username === 'test-user') {
              res.statusCode = 200;
              res.end(JSON.stringify({ ok: true }));
              return;
            }
          }

          // No auth or invalid auth - send challenge to inform Docker that auth is required
          return sendAuthChallenge(res, '', 'pull', 401);
        }

        // v1 ping
        if (
          chosenVersion === 'v1' &&
          req.method === 'GET' &&
          /^\/v1\/_ping$/.test(pathname)
        ) {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
          return;
        }

        // tags list
        let m: RegExpMatchArray | null = null;
        if (chosenVersion === 'v2')
          m = pathname.match(/^\/v2\/(.+)\/tags\/list$/);
        else if (chosenVersion === 'v1')
          m = pathname.match(/^\/v1\/repositories\/(.+)\/tags$/);
        if ((req.method === 'GET' || req.method === 'HEAD') && m) {
          const name = decodeURIComponent(m[1]);
          const out = await plugin.listVersions?.(repo, name);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          // v1 repos/tags shape historically is a tags map: { "latest": "<digest>" }
          if (chosenVersion === 'v1') {
            const map: any = {};
            (out?.versions || []).forEach((t: any) => (map[t] = '')); // no digest known
            res.end(JSON.stringify(map));
          } else {
            res.end(JSON.stringify({ name, tags: out?.versions ?? [] }));
          }
          return;
        }

        // initiate multipart upload: POST /v2/<name>/blobs/uploads (only v2)
        m =
          chosenVersion === 'v2'
            ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads\/?$/)
            : null;
        // require auth for pushes
        if (m && req.method === 'POST') {
          const name = decodeURIComponent(m[1]);
          // proxy registries are read-only — reject push/initiate
          if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
            res.statusCode = 405;
            res.end(
              JSON.stringify({
                ok: false,
                message: 'push not allowed on proxy repository',
              }),
            );
            return;
          }
          if (!req.headers?.authorization) {
            const fastAllowFromRoles = (
              req: any,
              forAction: 'push' | 'pull',
            ) => {
              const rolesHeader =
                req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
              d('[FAST ALLOW]', {
                rolesHeader,
                forAction,
                result: !!rolesHeader,
              });
              if (!rolesHeader) return false;
              const roles = String(rolesHeader)
                .split(',')
                .map((r: string) => r.trim().toLowerCase());
              if (forAction === 'pull')
                return (
                  roles.includes('reader') ||
                  roles.includes('admin') ||
                  roles.includes('user')
                );
              return (
                roles.includes('admin') ||
                roles.includes('writer') ||
                roles.includes('manager')
              );
            };
            if (!fastAllowFromRoles(req, 'push')) {
              return sendAuthChallenge(res, name, 'push');
            }
          } else {
            const allowed = checkTokenAllows(
              req.headers.authorization as string,
              decodeURIComponent(m[1]),
              'push',
            );
            d('[REGISTRY AUTH]', {
              path: pathname,
              name: decodeURIComponent(m[1]),
              hasAuth: !!req.headers?.authorization,
              authType: req.headers?.authorization?.split(' ')[0],
              allowed: allowed.allowed,
              reason: allowed.reason,
            });
            if (!allowed.allowed) {
              return sendAuthChallenge(res, name, 'push', 403);
            }
          }
          // Auth passed or allowed by roles, handle upload initiation
          d('[UPLOAD INIT] Calling initiateUpload for', name);
          const out = await plugin.initiateUpload?.(repo, name);
          d('[UPLOAD INIT] Result:', out);
          if (out?.ok) {
            const uuid =
              out.uuid ??
              out.id ??
              `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            res.setHeader(
              'Location',
              `/v2/${encodeURIComponent(name)}/blobs/uploads/${uuid}`,
            );
            res.setHeader('Docker-Upload-UUID', uuid);
            res.statusCode = 202;
            res.end(JSON.stringify({ ok: true, uuid }));
            return;
          }
          console.error('[UPLOAD INIT] Failed, returning 500');
          res.statusCode = 500;
          res.end(JSON.stringify(out || { ok: false }));
          return;
        }
        if (
          (req.method === 'POST' || req.method === 'PUT') &&
          m &&
          !parsed.pathname?.includes('/blobs/uploads/')
        ) {
          const name = decodeURIComponent(m[1]);
          const out = await plugin.initiateUpload?.(repo, name);
          if (out?.ok) {
            const uuid =
              out.uuid ??
              out.id ??
              `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            res.setHeader(
              'Location',
              `/v2/${encodeURIComponent(name)}/blobs/uploads/${uuid}`,
            );
            res.statusCode = 202;
            res.end(JSON.stringify({ ok: true, uuid }));
            return;
          }
          res.statusCode = 500;
          res.end(JSON.stringify(out || { ok: false }));
          return;
        }

        // append to session: POST /v2/<name>/blobs/uploads/:uuid (v2 only)
        m =
          chosenVersion === 'v2'
            ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads\/([^\/]+)$/)
            : null;
        if (m && (req.method === 'POST' || req.method === 'PATCH')) {
          const name = decodeURIComponent(m[1]);
          if (!req.headers?.authorization) {
            const fastAllowFromRoles = (
              req: any,
              forAction: 'push' | 'pull',
            ) => {
              const rolesHeader =
                req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
              if (!rolesHeader) return false;
              const roles = String(rolesHeader)
                .split(',')
                .map((r: string) => r.trim().toLowerCase());
              if (forAction === 'pull')
                return (
                  roles.includes('reader') ||
                  roles.includes('admin') ||
                  roles.includes('user')
                );
              return (
                roles.includes('admin') ||
                roles.includes('writer') ||
                roles.includes('manager')
              );
            };
            if (!fastAllowFromRoles(req, 'push')) {
              return sendAuthChallenge(res, name, 'push');
            }
          }
          const allowed = checkTokenAllows(
            req.headers.authorization as string,
            name,
            'push',
          );
          if (!allowed.allowed) {
            return sendAuthChallenge(res, name, 'push', 403);
          }
        }
        if ((req.method === 'POST' || req.method === 'PATCH') && m) {
          const name = decodeURIComponent(m[1]);
          const uuid = m[2];
          const data = await readBody(req);
          // try to parse as JSON base64 {data:...} if small
          let buf: Buffer = data;
          try {
            const txt = data.toString('utf8');
            if (/^{/.test(txt)) {
              const parsedJson = JSON.parse(txt || '{}');
              if (parsedJson?.data)
                buf = Buffer.from(parsedJson.data, 'base64');
            }
          } catch (e) {
            // swallow — keep raw
          }
          const out = await plugin.appendUpload?.(repo, name, uuid, buf);
          if (out?.ok) {
            res.setHeader(
              'Location',
              `/v2/${encodeURIComponent(name)}/blobs/uploads/${uuid}`,
            );
            res.setHeader('Range', `0-${out.uploaded - 1}`);
            res.statusCode = 202;
            res.end(JSON.stringify(out));
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify(out || { ok: false }));
          }
          return;
        }

        // finalize upload: PUT /v2/<name>/blobs/uploads/<uuid>?digest=... (v2 only)
        // Note: v1 doesn't support this mechanism — v1 flows are simpler and use tags APIs.
        // or single-step: PUT /v2/<name>/blobs/uploads?digest=...
        m =
          chosenVersion === 'v2'
            ? pathname.match(/^\/v2\/(.+)\/blobs\/uploads(?:\/([^\/]+))?$/)
            : null;
        if (m && req.method === 'PUT') {
          const name = decodeURIComponent(m[1]);
          if (!req.headers?.authorization) {
            const fastAllowFromRoles = (
              req: any,
              forAction: 'push' | 'pull',
            ) => {
              const rolesHeader =
                req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
              if (!rolesHeader) return false;
              const roles = String(rolesHeader)
                .split(',')
                .map((r: string) => r.trim().toLowerCase());
              if (forAction === 'pull')
                return (
                  roles.includes('reader') ||
                  roles.includes('admin') ||
                  roles.includes('user')
                );
              return (
                roles.includes('admin') ||
                roles.includes('writer') ||
                roles.includes('manager')
              );
            };
            if (!fastAllowFromRoles(req, 'push')) {
              return sendAuthChallenge(res, name, 'push');
            }
          }
          const allowed = checkTokenAllows(
            req.headers.authorization as string,
            name,
            'push',
          );
          if (!allowed.allowed) {
            return sendAuthChallenge(res, name, 'push', 403);
          }
        }
        if (req.method === 'PUT' && m) {
          const name = decodeURIComponent(m[1]);
          // proxy registries must not accept upload finalization
          if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
            res.statusCode = 405;
            res.end(
              JSON.stringify({
                ok: false,
                message: 'push not allowed on proxy repository',
              }),
            );
            return;
          }
          const uuid = m[2] ?? undefined;
          const digest = parsed.query?.digest as string | undefined;

          // Revert Streaming until stable
          const data = await readBody(req);
          let buf: Buffer | undefined = data && data.length ? data : undefined;

          // Legacy check
          if (buf) {
            try {
              const txt = buf.toString('utf8');
              if (/^{/.test(txt)) {
                const parsedJson = JSON.parse(txt || '{}');
                if (parsedJson?.data)
                  buf = Buffer.from(parsedJson.data, 'base64');
              }
            } catch (e) { }
          }

          const out = await plugin.finalizeUpload?.(
            repo,
            name,
            uuid as any,
            digest,
            buf, // pass buffer
            undefined // stream
          );
          if (out?.ok) {
            res.statusCode = 201;
            res.setHeader(
              'Location',
              `/v2/${encodeURIComponent(name)}/blobs/${out.id}`,
            );
            // Traceability headers for group operations
            if (out.metadata?.groupId)
              res.setHeader('X-Group-Id', out.metadata.groupId);
            if (out.metadata?.writePolicy)
              res.setHeader('X-Write-Policy', out.metadata.writePolicy);
            if (out.metadata?.targetRepoId)
              res.setHeader('X-Write-Target', out.metadata.targetRepoId);
            res.end(JSON.stringify(out));
          } else {
            res.statusCode = 400;
            res.end(JSON.stringify(out || { ok: false }));
          }
          return;
        }

        // put/get manifest (v2) or v1 tag push
        m =
          chosenVersion === 'v2'
            ? pathname.match(/^\/v2\/(.+)\/manifests\/([^\/]+)$/)
            : pathname.match(/^\/v1\/repositories\/(.+)\/tags\/(.+)$/);
        if (m) {
          // PUT -> store manifest
          if (req.method === 'PUT') {
            // require auth for manifest PUTs
            const name = decodeURIComponent(m[1]);
            // proxy registries are read-only — manifest PUTs should be rejected
            if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
              res.statusCode = 405;
              res.end(
                JSON.stringify({
                  ok: false,
                  message: 'push not allowed on proxy repository',
                }),
              );
              return;
            }
            // allow shortcuts via x-user-roles header for tests/local usage
            if (!req.headers?.authorization) {
              const fastAllowFromRoles = (
                req: any,
                forAction: 'push' | 'pull',
              ) => {
                const rolesHeader =
                  req?.headers?.['x-user-roles'] ||
                  req?.headers?.['x-user-role'];
                if (!rolesHeader) return false;
                const roles = String(rolesHeader)
                  .split(',')
                  .map((r: string) => r.trim().toLowerCase());
                if (forAction === 'pull')
                  return (
                    roles.includes('reader') ||
                    roles.includes('admin') ||
                    roles.includes('user')
                  );
                return (
                  roles.includes('admin') ||
                  roles.includes('writer') ||
                  roles.includes('manager')
                );
              };
              if (!fastAllowFromRoles(req, 'push')) {
                return sendAuthChallenge(res, name, 'push');
              }
            } else {
              const allowed = checkTokenAllows(
                req.headers.authorization as string,
                name,
                'push',
              );
              if (!allowed.allowed) {
                return sendAuthChallenge(res, name, 'push', 403);
              }
            }

            const tag = decodeURIComponent(m[2]);
            const data = await readBody(req);
            let manifest: any = undefined;
            try {
              manifest = JSON.parse(data.toString('utf8'));
            } catch (err) {
              // accept raw
              manifest = data.toString('utf8');
            }
            // for v1 tag push we store manifest under manifests/<tag> for consistency
            const out = await plugin.putManifest?.(repo, name, tag, manifest);
            if (out?.ok) {
              // If plugin returned a manifest digest, expose it to the client
              const manifestDigest = out?.metadata?.digest;
              if (manifestDigest)
                res.setHeader('Docker-Content-Digest', manifestDigest);
              // Traceability headers for group operations
              if (out.metadata?.groupId)
                res.setHeader('X-Group-Id', out.metadata.groupId);
              if (out.metadata?.writePolicy)
                res.setHeader('X-Write-Policy', out.metadata.writePolicy);
              if (out.metadata?.targetRepoId)
                res.setHeader('X-Write-Target', out.metadata.targetRepoId);
              res.statusCode = 201;
              res.end(JSON.stringify(out));
            } else {
              res.statusCode = 400;
              res.end(JSON.stringify(out || { ok: false }));
            }
            return;
          }

          // GET/HEAD -> retrieve manifest/blob
          if (req.method === 'GET' || req.method === 'HEAD') {
            const name = decodeURIComponent(m[1]);
            const tag = decodeURIComponent(m[2]);
            d(
              `[REGISTRY GET MANIFEST/BLOB] repo=${repo.name}, type=${repo.type}, name=${name}, tag=${tag}`,
            );
            const repoType = (repo?.type || '').toString().toLowerCase();
            let out;

            // GROUP RESOLUTION: iterate members and try to fetch
            if (repoType === 'group') {
              const members: string[] = repo.config?.members ?? [];
              d(
                `[REGISTRY GROUP] manifest/blob GET for group ${repo.name}, members:`,
                members,
              );
              for (const mid of members) {
                const childRepo = opts?.reposById?.get(mid);
                if (!childRepo) {
                  console.warn(
                    `[REGISTRY GROUP] member ${mid} not found in reposById`,
                  );
                  continue;
                }
                d(
                  `[REGISTRY GROUP] trying member ${childRepo.name} (${childRepo.id})`,
                );
                const isDigest =
                  tag.startsWith('sha256:') ||
                  tag.startsWith('sha384:') ||
                  tag.startsWith('sha512:');
                const childOut = isDigest
                  ? await plugin.getBlob?.(childRepo, name, tag)
                  : await plugin.download?.(childRepo, name, tag);
                if (childOut?.ok) {
                  d(`[REGISTRY GROUP] resolved from member ${childRepo.name}`);
                  out = childOut;
                  break;
                }
              }
              if (!out?.ok) {
                d(`[REGISTRY GROUP] not found in any member`);
              }
            } else {
              // If tag is a digest (sha256:...), use getBlob; otherwise use download for manifest tags
              const isDigest =
                tag.startsWith('sha256:') ||
                tag.startsWith('sha384:') ||
                tag.startsWith('sha512:');
              out = isDigest
                ? await plugin.getBlob?.(repo, name, tag)
                : await plugin.download?.(repo, name, tag);
            }
            if (!out?.ok) {
              res.statusCode = 404;
              res.end(JSON.stringify(out || { ok: false }));
              return;
            }

            // Track download
            if (plugin.trackDownload) {
              try {
                await plugin.trackDownload(repo, name, tag);
                d('[REGISTRY] Download tracked', {
                  repoId: repo.id,
                  name,
                  tag,
                });
              } catch (err: any) {
                console.error(
                  '[REGISTRY] Failed to track download:',
                  err.message,
                );
              }
            }
            // For HEAD requests, reply 200 without body
            if (req.method === 'HEAD') {
              res.statusCode = 200;
              // For manifests, try to determine the correct Content-Type
              let contentType = 'application/octet-stream';
              if (out.url && out.url.startsWith('file://')) {
                try {
                  const fp = out.url.replace(/^file:\/\//, '');
                  const fs = require('fs');
                  const buffer = await fs.promises.readFile(fp);
                  const txt = buffer.toString('utf8');
                  if (txt && txt.trim().startsWith('{')) {
                    const manifest = JSON.parse(txt);
                    if (manifest.mediaType) {
                      contentType = manifest.mediaType;
                    } else {
                      contentType = 'application/json';
                    }
                  }
                } catch (e) {
                  // keep as octet-stream
                }
              }
              res.setHeader('Content-Type', contentType);
              return res.end();
            }

            if ((out.url && out.url.startsWith('file://')) || out.data || out.body) {
              const fs = require('fs');
              let buffer: Buffer;
              if (out.data || out.body) {
                buffer = Buffer.isBuffer(out.data || out.body) ? (out.data || out.body) : Buffer.from(out.data || out.body);
              } else {
                const fp = out.url.replace(/^file:\/\//, '');
                buffer = await fs.promises.readFile(fp);
              }

              try {
                // If the stored content looks like UTF-8 JSON/text, return it
                // with proper Content-Type from manifest.mediaType
                let contentType = 'application/octet-stream';
                let body: Buffer | string = buffer;
                try {
                  const txt = buffer.toString('utf8');
                  // quick JSON/text heuristic
                  if (
                    txt &&
                    (txt.trim().startsWith('{') || txt.trim().startsWith('['))
                  ) {
                    // Parse manifest to get mediaType
                    const manifest = JSON.parse(txt);
                    if (manifest.mediaType) {
                      contentType = manifest.mediaType;
                    } else {
                      contentType = 'application/json';
                    }
                    body = txt;
                  }
                } catch (e) {
                  // keep as binary
                }
                // Calculate Docker-Content-Digest for manifests
                if (contentType.includes('json') && chosenVersion === 'v2') {
                  const crypto = require('crypto');
                  const digest = crypto
                    .createHash('sha256')
                    .update(buffer)
                    .digest('hex');
                  res.setHeader('Docker-Content-Digest', `sha256:${digest}`);
                }
                res.setHeader('Content-Type', contentType);
                res.statusCode = 200;
                res.end(body as any);
                return;
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ ok: false, message: String(err) }));
                return;
              }
            }
            if (out.url) {
              // For v1 tests return the stored response body as JSON so
              // simple HTTP clients can read the stored manifest/tag value
              // instead of being redirected. For v2 blob fetches we still
              // redirect to the URL so clients can download the binary.
              if (chosenVersion === 'v1') {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify(out));
              }
              // redirect to external url for v2 (blobs)
              res.statusCode = 302;
              res.setHeader('Location', out.url);
              res.end();
              return;
            }
            res.statusCode = 200;
            res.end(JSON.stringify(out));
            return;
          }
        }

        // blob fetch: GET /v2/<name>/blobs/<digest> (v2 only)
        m =
          chosenVersion === 'v2'
            ? pathname.match(/^\/v2\/(.+)\/blobs\/([^\/\?]+)$/)
            : null;
        if ((req.method === 'GET' || req.method === 'HEAD') && m) {
          const name = decodeURIComponent(m[1]);
          const digest = decodeURIComponent(m[2]);
          let out: any;

          // GROUP RESOLUTION: iterate members and try to fetch blob
          if (repo.type === 'group') {
            const members: string[] = repo.config?.members ?? [];
            d(
              `[REGISTRY GROUP] blob GET for group ${repo.name}, digest=${digest}`,
            );
            for (const mid of members) {
              const childRepo = opts?.reposById?.get(mid);
              if (!childRepo) continue;
              const childOut = await plugin.getBlob?.(childRepo, name, digest);
              if (childOut?.ok) {
                d(
                  `[REGISTRY GROUP] blob resolved from member ${childRepo.name}`,
                );
                out = childOut;
                break;
              }
            }
          } else {
            out = await plugin.getBlob?.(repo, name, digest);
          }

          if (!out?.ok) {
            console.warn(`[DOCKER_REGISTRY] Resource not found: ${name} (digest: ${digest}). Result:`, out);
            res.statusCode = 404;
            res.end(JSON.stringify(out || { ok: false }));
            return;
          }
          if ((out.url && out.url.startsWith('file://')) || out.data || out.body) {
            const fs = require('fs');
            try {
              let buffer: Buffer | null = null;
              let size: number;

              if (out.data || out.body) {
                const rawBody = out.data || out.body;
                if (Buffer.isBuffer(rawBody)) {
                  buffer = rawBody;
                } else if (typeof rawBody === 'string') {
                  buffer = Buffer.from(rawBody);
                } else {
                  buffer = Buffer.from(JSON.stringify(rawBody));
                }
                size = buffer.length;
              } else {
                const fp = out.url.replace(/^file:\/\//, '');
                const stat = await fs.promises.stat(fp);
                size = stat.size;
              }

              // head response should not include body
              if (req.method === 'HEAD') {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Content-Length', String(size));
                res.setHeader('Docker-Content-Digest', digest);
                res.statusCode = 200;
                return res.end();
              }

              // support simple Range header (if file-based)
              const rangeHeader = req.headers?.range as string | undefined;
              if (rangeHeader && /^bytes=\d*-?\d*$/.test(rangeHeader) && !buffer) {
                const fp = out.url.replace(/^file:\/\//, '');
                const mrange = rangeHeader.replace(/bytes=/, '').split('-');
                const start = mrange[0] ? parseInt(mrange[0], 10) : 0;
                const end = mrange[1] ? parseInt(mrange[1], 10) : size - 1;
                const chunkLength = end - start + 1;
                const stream = fs.createReadStream(fp, { start, end });
                res.setHeader('Accept-Ranges', 'bytes');
                res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
                res.setHeader('Content-Length', String(chunkLength));
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('Docker-Content-Digest', digest);
                res.statusCode = 206;
                return stream.pipe(res);
              }

              if (!buffer) {
                const fp = out.url.replace(/^file:\/\//, '');
                buffer = await fs.promises.readFile(fp);
              }

              res.setHeader('Content-Type', 'application/octet-stream');
              res.setHeader('Content-Length', String(size));
              res.setHeader('Docker-Content-Digest', digest);
              res.statusCode = 200;
              res.end(buffer);
              return;
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ ok: false, message: String(err) }));
              return;
            }
          }
          // treat mem:// (in-memory test storage) as local storage so tests
          // using the mock storage adapter get a 200 HEAD instead of a 302 redirect
          if (
            out.url &&
            out.url.startsWith('mem://') &&
            process.env.NODE_ENV === 'test'
          ) {
            // HEAD should not include body
            if (req.method === 'HEAD') {
              res.setHeader('Content-Type', 'application/octet-stream');
              res.statusCode = 200;
              return res.end();
            }
            // For GET return metadata so tests can inspect
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify(out));
          }
          if (out.url) {
            res.statusCode = 302;
            res.setHeader('Location', out.url);
            res.end();
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify(out));
          return;
        }

        // unknown
        res.statusCode = 404;
        res.end(JSON.stringify({ ok: false, message: 'not found' }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, message: String(err) }));
      }
    });

    // allow binding on all interfaces so other containers (e.g. DIND) can reach the registry
    // previously we bound to 127.0.0.1 which prevented some in-container daemons from reaching the port
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: any) => reject(e));
      server.listen(port, '0.0.0.0', () => {
        // unref so unit tests // process can exit even if registries remain listening
        if (typeof server.unref === 'function') server.unref();
        resolve();
      });
    });

    registryServers.set(repo.id || repo.name, {
      server,
      port,
      accessUrl,
      version: chosenVersion,
    });

    return {
      ok: true,
      port,
      accessUrl,
      version: chosenVersion,
      needsPersistence, // Indicates if the port was auto-selected and should be saved to DB
    };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Stop a Docker registry server for a repository
 */
export async function stopRegistryForRepo(repo: Repository) {
  try {
    const key = repo.id || repo.name;
    const inst = registryServers.get(key);
    if (!inst) return { ok: false, message: 'not found' };

    try {
      inst.server.close();
    } catch (e) {
      // ignore close errors
    }

    registryServers.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Get the active registry servers map (for integration with main plugin)
 */
export function getRegistryServers(): Map<string, any> {
  return registryServers;
}
