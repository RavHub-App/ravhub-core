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
import { runWithLock } from '../../../../../plugins-core/lock-helper';

export function initStorage(context: PluginContext) {
  const { storage } = context;

  const getProxyHelper = () => {
    try {
      return require('../../../../../plugins-core/proxy-helper').default;
    } catch {
      return null;
    }
  };

  const getBufferFromPkg = (pkg: any): Buffer => {
    const data = pkg?.content ?? JSON.stringify(pkg ?? {});
    if (pkg?.encoding === 'base64' && typeof data === 'string')
      return Buffer.from(data, 'base64');
    return Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  };

  const handleGroupUpload = async (
    repo: Repository,
    pkg: any,
    uploadFn: (r: Repository, p: any) => Promise<any>,
  ): Promise<any> => {
    const writePolicy = repo.config?.writePolicy || 'none';
    const members = repo.config?.members || [];
    if (writePolicy === 'none')
      return { ok: false, message: 'Group is read-only' };

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
        const result = await uploadFn(member, pkg);
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
      return await uploadFn(member, pkg);
    }

    if (writePolicy === 'mirror') {
      const hosted = await getHostedMembers();
      if (hosted.length === 0)
        return { ok: false, message: 'No hosted members' };
      const results = await Promise.all(hosted.map((m) => uploadFn(m, pkg)));
      return (
        results.find((r) => r.ok) || {
          ok: false,
          message: 'Mirror write failed',
        }
      );
    }
    return { ok: false, message: 'Unknown write policy' };
  };

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    if (repo.type === 'group') return handleGroupUpload(repo, pkg, upload);

    const name = pkg?.name || 'vendor/package';
    const version = pkg?.version || '0.0.1';
    const storageVersion = version.endsWith('.zip')
      ? version
      : `${version}.zip`;
    const keyId = buildKey('composer', repo.id, name, storageVersion);

    if (repo.config?.allowRedeploy === false) {
      const keyName = buildKey('composer', repo.name, name, storageVersion);
      if (
        (await storage.get(keyId).catch(() => null)) ||
        (await storage.get(keyName).catch(() => null))
      ) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    const buf = getBufferFromPkg(pkg);

    try {
      const result = await storage.save(keyId, buf);
      const uploadResult = {
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

      // Index artifact in DB for UI listing
      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, uploadResult);
        } catch (e) {
          console.error('[Composer] Failed to index artifact:', e);
        }
      }

      return uploadResult;
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

      // For group writes, we currently buffer to support multiple members/retries
      let buf: Buffer;
      if (req.body && Buffer.isBuffer(req.body)) {
        buf = req.body;
      } else if (req.buffer && Buffer.isBuffer(req.buffer)) {
        buf = req.buffer;
      } else {
        const chunks: any[] = [];
        for await (const chunk of req) chunks.push(chunk);
        buf = Buffer.concat(chunks);
      }
      const delegateReq = { ...req, body: buf, buffer: buf };
      // Ensure the stream is not consumed again if we pass the original req object
      // (which we shouldn't do anyway for delegations, we pass the buffered body)

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await handlePut(member, path, delegateReq);
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
        return await handlePut(member, path, delegateReq);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(
          hosted.map((m) => handlePut(m, path, delegateReq)),
        );
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }
    if (
      path.endsWith('.zip') &&
      typeof storage.saveStream === 'function' &&
      !req.body &&
      !req.buffer
    ) {
      const parts = path.split('/').filter((p) => p);
      let name = 'vendor/package';
      let version = '0.0.1';
      if (parts.length >= 3) {
        name = `${parts[0]}/${parts[1]}`;
        version = parts[2].replace('.zip', '');
      }
      const keyId = buildKey(
        'composer',
        repo.id,
        name,
        parts[parts.length - 1],
      );

      try {
        const result = await storage.saveStream(keyId, req);
        const streamResult = {
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

        // Index artifact in DB for UI listing
        if (context.indexArtifact) {
          try {
            await context.indexArtifact(repo, streamResult);
          } catch (e) {
            console.error('[Composer] Failed to index artifact:', e);
          }
        }

        return streamResult;
      } catch (err: any) {
        return { ok: false, message: String(err) };
      }
    }

    let buf: Buffer;
    if (Buffer.isBuffer(req.body)) buf = req.body;
    else if (typeof req.body === 'object')
      buf = Buffer.from(JSON.stringify(req.body));
    else if (req.body) buf = Buffer.from(String(req.body));
    else {
      const chunks: any[] = [];
      for await (const chunk of req) chunks.push(chunk);
      buf = Buffer.concat(chunks);
    }

    let pkg: any = { content: buf };
    try {
      const json = JSON.parse(buf.toString());
      if (json.name) pkg = { ...json, content: buf };
    } catch { }

    if (path && path !== '/') {
      const parts = path.split('/').filter((p) => p);
      if (parts.length >= 3) {
        pkg.name = pkg.name || `${parts[0]}/${parts[1]}`;
        pkg.version = pkg.version || parts[2].replace('.zip', '');
      }
    }
    return upload(repo, pkg);
  };

  const proxyDownload = async (
    repo: Repository,
    url: string,
    name: string,
    version: string,
  ) => {
    const cleanVersion = version.split('?')[0].split('#')[0];
    const cacheEnabled = repo.config?.cacheEnabled !== false;
    let storageVersion = cleanVersion;
    if (!storageVersion.endsWith('.zip')) storageVersion += '.zip';

    const keyId = buildKey('composer', repo.id, 'proxy', name, storageVersion);

    let skipCacheCheck = false;
    if (cacheEnabled) {
      try {
        const existing = await storage.get(keyId).catch(() => null);
        if (existing) {
          const proxyHelper = getProxyHelper();
          if (proxyHelper) {
            try {
              const headRes = await proxyHelper(repo, url, {
                method: 'HEAD',
                timeoutMs: 5000,
              });
              if (headRes.ok && headRes.headers) {
                const cl = headRes.headers['content-length'];
                if (cl && parseInt(cl) !== existing.length) {
                  skipCacheCheck = true;
                } else {
                  return { ok: true, data: existing, skipCache: true };
                }
              }
            } catch {
              return { ok: true, data: existing, skipCache: true };
            }
          }
        }
      } catch { }
    }

    const proxyHelper = getProxyHelper();
    if (!proxyHelper) return { ok: false, message: 'Proxy helper missing' };

    // Locking & Coalescing
    const lockKey = `composer:${repo.id}:${name}:${version}`;
    return await runWithLock(context, lockKey, async () => {
      if (cacheEnabled && !skipCacheCheck) {
        const cached = await storage.get(keyId).catch(() => null);
        if (cached) {
          return { ok: true, data: cached, skipCache: true };
        }
      }

      const res = await proxyHelper(repo, url);
      if (res.ok && res.body) {
        const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
        if (cacheEnabled && cacheMaxAgeDays > 0) {
          try {
            await storage.save(keyId, res.body);
            if (context.indexArtifact) {
              await context.indexArtifact(repo, {
                ok: true,
                id: `${name}:${version}`,
                metadata: {
                  name,
                  version,
                  storageKey: keyId,
                  size: res.body.length,
                  filename: `${name.split('/').pop()}-${version}.zip`,
                },
              });
            }
          } catch { }
        }
        return { ...res, skipCache: true };
      }
      return res;
    });
  };

  const download = async (
    repo: Repository,
    name: string,
    version?: string,
  ): Promise<any> => {
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

    if (repo.type === 'hosted' && name === 'packages.json') {
      // simplified metadata listing
      const prefix = buildKey('composer', repo.id);
      try {
        const keys = await storage.list(prefix);
        const packages: any = {};
        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        const baseUrl = `${proto}://${host}/repository/${repo.name}`;

        for (const key of keys) {
          const parts = key.split('/');
          if (parts.length >= 5) {
            const ver = decodeURIComponent(parts.pop()!);
            const pkgName = parts
              .slice(2)
              .map((p) => decodeURIComponent(p))
              .join('/');
            const cleanVer = ver.endsWith('.zip') ? ver.slice(0, -4) : ver;
            if (!packages[pkgName]) packages[pkgName] = {};
            packages[pkgName][cleanVer] = {
              name: pkgName,
              version: cleanVer,
              dist: { url: `${baseUrl}/${pkgName}/${ver}`, type: 'zip' },
            };
          }
        }
        return {
          ok: true,
          data: JSON.stringify({ packages }),
          contentType: 'application/json',
        };
      } catch {
        return {
          ok: true,
          data: JSON.stringify({ packages: {} }),
          contentType: 'application/json',
        };
      }
    }

    if (repo.type === 'proxy') {
      if (
        name === 'packages.json' ||
        name.startsWith('p/') ||
        name.includes('.json')
      ) {
        const { initMetadata } = require('../proxy/metadata');
        return initMetadata(context).proxyMetadata(repo, name);
      }
      const upstream = repo.config?.proxyUrl;
      if (upstream) {
        const cleanUpstream = upstream.endsWith('/')
          ? upstream.slice(0, -1)
          : upstream;
        let artifactName = name;
        let artifactVersion = version;

        if (!artifactVersion && name.endsWith('.zip')) {
          const parts = name.split('/');
          const filename = parts.pop();
          if (filename) {
            artifactVersion = filename.slice(0, -4);
            artifactName = parts.join('/');
          }
        }
        return proxyDownload(
          repo,
          `${cleanUpstream}/${name}`,
          artifactName,
          artifactVersion || 'latest',
        );
      }
    }

    if (!version) {
      const parts = name.split('/');
      if (parts.length >= 3) {
        version = parts.pop();
        name = parts.join('/');
      } else {
        return { ok: false, message: 'Version required' };
      }
    }

    const storageVersion = version!.endsWith('.zip')
      ? version!
      : `${version!}.zip`;
    const storageKeyId = buildKey('composer', repo.id, name, storageVersion);
    try {
      let data = await storage.get(storageKeyId).catch(() => null);
      if (!data) {
        const keyName = buildKey('composer', repo.name, name, storageVersion);
        data = await storage.get(keyName).catch(() => null);
      }
      if (!data) return { ok: false, message: 'Not found' };
      return { ok: true, data, contentType: 'application/zip' };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { upload, download, proxyDownload, handlePut };
}
