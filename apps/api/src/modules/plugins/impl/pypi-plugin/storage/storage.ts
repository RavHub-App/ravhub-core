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

import { buildKey } from '../utils/key-utils';
import { PluginContext, Repository } from '../utils/types';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

export function initStorage(context: PluginContext) {
  const { storage } = context;

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    // Group Write Policy Logic
    if (repo.type === 'group') {
      const writePolicy = repo.config?.writePolicy || 'none';
      const members = repo.config?.members || [];

      if (writePolicy === 'none') {
        return { ok: false, message: 'Group is read-only' };
      }

      const getHostedMembers = async () => {
        const hosted: Repository[] = [];
        if (!context.getRepo) return hosted;
        for (const id of members) {
          const m = await context.getRepo(id);
          if (m && m.type === 'hosted') hosted.push(m);
        }
        return hosted;
      };

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await upload(member, pkg);
          if (result.ok) return result;
        }
        return { ok: false, message: 'No writable member found' };
      }

      if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
        const preferredId = repo.config?.preferredWriter;
        if (!preferredId)
          return { ok: false, message: 'Preferred writer not configured' };
        const member = await context.getRepo?.(preferredId);
        if (!member || member.type !== 'hosted')
          return { ok: false, message: 'Preferred writer unavailable' };
        return await upload(member, pkg);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(hosted.map((m) => upload(m, pkg)));
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    const name = pkg?.name || 'pkg';
    const version = pkg?.version || '0.0.1';
    // Use provided filename or default to tar.gz for hosted packages
    const filename = pkg?.filename || `${name}-${version}.tar.gz`;

    // Store under .../version/filename to mimic standard repo structure
    const keyId = buildKey('pypi', repo.id, name, version, filename);
    const keyName = buildKey('pypi', repo.name, name, version, filename);

    const data = pkg?.content ?? JSON.stringify(pkg ?? {});
    let buf: Buffer;
    if (pkg?.encoding === 'base64' && typeof data === 'string') {
      buf = Buffer.from(data, 'base64');
    } else {
      buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    }

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const existingId = await storage.get(keyId).catch(() => null);
      const existingName = await storage.get(keyName).catch(() => null);
      if (existingId || existingName) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    try {
      const result = await storage.save(keyId, buf);
      const artifactResult = {
        ok: true,
        id: `${name}:${version}`,
        metadata: {
          name,
          version,
          storageKey: keyId,
          size: result.size ?? buf.length,
          contentHash: result.contentHash,
        },
      };

      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, artifactResult);
        } catch (e) {
          console.error('[PyPIPlugin] Failed to index artifact:', e);
        }
      }

      return artifactResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    // Group Write Policy Logic
    if (repo.type === 'group') {
      const writePolicy = repo.config?.writePolicy || 'none';
      const members = repo.config?.members || [];

      if (writePolicy === 'none') {
        return { ok: false, message: 'Group is read-only' };
      }

      const getHostedMembers = async () => {
        const hosted: Repository[] = [];
        if (!context.getRepo) return hosted;
        for (const id of members) {
          const m = await context.getRepo(id);
          if (m && m.type === 'hosted') hosted.push(m);
        }
        return hosted;
      };

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await handlePut(member, path, req);
          if (result.ok) return result;
        }
        return { ok: false, message: 'No writable member found' };
      }

      if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
        const preferredId = repo.config?.preferredWriter;
        if (!preferredId)
          return { ok: false, message: 'Preferred writer not configured' };
        const member = await context.getRepo?.(preferredId);
        if (!member || member.type !== 'hosted')
          return { ok: false, message: 'Preferred writer unavailable' };
        return await handlePut(member, path, req);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(hosted.map((m) => handlePut(m, path, req)));
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    // PyPI path structure often: /package/version/filename
    const parts = path.split('/').filter((p) => p);
    let name = 'pkg';
    let version = '0.0.1';
    let filename = 'package.tar.gz';

    if (parts.length >= 3) {
      name = parts[0];
      version = parts[1];
      filename = parts[2];
    } else if (parts.length === 2) {
      name = parts[0];
      version = parts[1];
    } else if (parts.length === 1) {
      name = parts[0];
    }

    const keyId = buildKey('pypi', repo.id, name, version, filename);

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const exists = await storage.exists(keyId).catch(() => false);
      if (exists) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    try {
      let result: any;
      if (
        typeof storage.saveStream === 'function' &&
        !req.body &&
        !req.buffer
      ) {
        result = await storage.saveStream(keyId, req);
      } else {
        let buf: Buffer;
        if (
          req.body &&
          (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))
        ) {
          if (Buffer.isBuffer(req.body)) {
            buf = req.body;
          } else if (typeof req.body === 'object') {
            buf = Buffer.from(JSON.stringify(req.body));
          } else {
            buf = Buffer.from(String(req.body));
          }
        } else {
          const chunks: any[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          buf = Buffer.concat(chunks);
        }
        await storage.save(keyId, buf);
        result = { ok: true, size: buf.length };
      }

      const artifactResult = {
        ok: true,
        id: `${name}:${version}`,
        metadata: {
          name,
          version,
          storageKey: keyId,
          size: result.size,
          contentHash: result.contentHash,
        },
      };

      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, artifactResult);
        } catch (e) {
          console.error('[PyPIPlugin] Failed to index artifact:', e);
        }
      }

      return artifactResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const download = async (repo: Repository, name: string, version?: string) => {
    // Implement PEP 503 (Simple Repository API)
    if (name === 'simple' || name.startsWith('simple/')) {
      let pkgName = name === 'simple' ? '' : name.replace('simple/', '').replace(/\/$/, '');

      // Root /simple/ - List all packages (optional but good practice)
      if (!pkgName) {
        // NOTE: Listing all packages might be expensive in storage-based approach. 
        // Return empty or basic valid HTML.
        return {
          ok: true,
          contentType: 'text/html',
          data: Buffer.from(`<!DOCTYPE html><html><body><h1>Simple Index</h1></body></html>`)
        };
      }

      // Package Detail /simple/<package>/ - List versions/files
      let links: string[] = [];

      // Check Hosted files
      // We look for keys like pypi/<repoId>/<pkgName>/<version>/<filename>
      // But storage.list usually works on prefix. 
      // Our structure: pypi/id/pkg/ver/file
      // We can list pypi/id/pkg
      const prefix = buildKey('pypi', repo.id, pkgName);
      try {
        const keys = await storage.list(prefix);
        // Expected key: .../pkgName/version/filename
        // Map to filename and relative URL
        // URL in simple API: ../../packages/<pkgName>/<version>/<filename> (relative to /simple/pkg/)
        // Or absolute: /repository/<repo>/<pkgName>/<version>/<filename>

        // Note: ReposController maps :id/* to download.
        // If we return a link /repository/repo/pkg/ver/file, fetching it calls download('pkg/ver/file').

        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        const baseUrl = `${proto}://${host}/repository/${repo.name}`;

        keys.forEach((k: string) => {
          const parts = k.split('/');
          // pypi, id, pkgName, version, filename
          if (parts.length >= 5) {
            const ver = parts[3];
            const file = parts[4];
            // Construct a download link that goes back to ReposController
            // Using path: pkgName/version/file
            // This matches 'download' logic when not starting with 'simple/'
            const href = `${baseUrl}/${pkgName}/${ver}/${file}`;
            links.push(`<a href="${href}">${file}</a>`);
          }
        });

      } catch (e) { }

      // Proxy Logic
      if (repo.type === 'proxy') {
        const upstream = repo.config?.proxyUrl || repo.config?.url;
        if (upstream) {
          // Try to fetch upstream simple index
          // Upstream: https://pypi.org/simple/<pkgName>/
          const target = `${upstream.replace(/\/$/, '')}/simple/${pkgName}/`;
          try {
            const res = await proxyFetchWithAuth(repo, target) as any;
            if (res.ok && res.body) {

              return {
                ok: true,
                contentType: res.headers?.['content-type'] || 'text/html',
                data: res.body
              };
            }
          } catch (e) { }
        }
      }

      const html = `<!DOCTYPE html>
<html>
<head><title>Links for ${pkgName}</title></head>
<body>
<h1>Links for ${pkgName}</h1>
${links.join('<br/>\n')}
</body>
</html>`;
      return {
        ok: true,
        contentType: 'text/html',
        data: Buffer.from(html)
      };
    }


    if (!version) {
      // Try to parse from name (path)
      const parts = name.split('/');
      if (parts.length >= 2) {
        version = parts.pop();
        name = parts.join('/');
      } else {
        return { ok: false, message: 'Version required for download' };
      }
    }

    // Group Read Logic
    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      for (const id of members) {
        const member = await context.getRepo?.(id);
        if (member) {
          const result = await download(member, name, version);
          if (result.ok) return result;
        }
      }
      return { ok: false, message: 'Not found in group' };
    }

    const storageKeyId = buildKey('pypi', repo.id, name, version);
    const storageKeyName = buildKey('pypi', repo.name, name, version);

    // Check storage
    try {
      // 1. Try exact match (legacy behavior: .../version is the file)
      let data = await storage.get(storageKeyId).catch(() => null);
      if (!data) data = await storage.get(storageKeyName).catch(() => null);

      // 2. If not found, try listing directory (new behavior: .../version/filename)
      if (!data) {
        const listId = await storage.list(storageKeyId).catch(() => []);
        if (listId && listId.length > 0) {
          // Pick the first file found in the version directory
          // Prefer .whl (binary) over .tar.gz (source), otherwise take first available
          // Ensure we don't pick the directory itself if it's in the list
          const files = listId.filter(f => f !== storageKeyId && f !== storageKeyId + '/');
          if (files.length > 0) {
            const preferred =
              files.find((f: string) => f.endsWith('.whl')) ||
              files.find((f: string) => f.endsWith('.tar.gz')) ||
              files[0];
            data = await storage.get(preferred).catch(() => null);
          }
        }
      }

      if (!data) {
        const listName = await storage.list(storageKeyName);
        if (listName && listName.length > 0) {
          data = await storage.get(listName[0]);
        }
      }

      if (data) {
        return {
          ok: true,
          data,
          contentType: 'application/octet-stream',
        };
      } else {
      }
    } catch (err) {
      // ignore
    }

    // Proxy Logic
    if (repo.type === 'proxy') {
      const upstreamUrl = repo.config?.proxyUrl || repo.config?.url;
      if (upstreamUrl) {
        // Normal file download logic (not simple API)
        const targetUrl = `${upstreamUrl}/${name}/${version}`;
        const proxyKey = buildKey('pypi', repo.id, 'proxy', name, version);

        return await runWithLock(context, proxyKey, async () => {
          const cached = await storage.get(proxyKey);
          if (cached) {
            return {
              ok: true,
              data: cached,
              contentType: 'application/octet-stream',
            };
          }

          try {
            const res = await proxyFetchWithAuth(repo, targetUrl);
            if (res.ok && (res as any).body) {
              await storage.save(proxyKey, (res as any).body as Buffer);

              // Index artifact (optional for proxy)
              if (context.indexArtifact) {
                try {
                  await context.indexArtifact(repo, {
                    ok: true,
                    id: `${name}:${version}`,
                    metadata: {
                      name,
                      version,
                      storageKey: proxyKey,
                      size: ((res as any).body as Buffer).length,
                    },
                  });
                } catch (e) {
                  // ignore
                }
              }
              return { ...res, data: (res as any).body, skipCache: true };
            }
            return res;
          } catch (e) {
            return { ok: false, message: String(e) };
          }
        });
      }
    }

    return { ok: false, message: 'Not found' };
  };

  return { upload, download, handlePut };
}
