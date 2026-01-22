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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import { runWithLock } from '../../../../../plugins-core/lock-helper';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { buildKey } from '../utils/key-utils';

const isBase64 = (s: string) =>
  /^[A-Za-z0-9+/]+={0,2}$/.test(s.trim()) && s.trim().length % 4 === 0;

const getBufferFromPackage = (pkg: any): Buffer => {
  if (!pkg) return Buffer.from([]);
  if (Buffer.isBuffer(pkg.buffer)) return pkg.buffer;
  if (pkg.buffer?.type === 'Buffer' && Array.isArray(pkg.buffer.data))
    return Buffer.from(pkg.buffer.data);

  const content = pkg.content ?? pkg.data;
  if (Buffer.isBuffer(content)) return content;

  if (typeof content === 'string') {
    if (isBase64(content)) {
      try {
        return Buffer.from(content, 'base64');
      } catch { }
    }
    return Buffer.from(content);
  }

  return Buffer.from(JSON.stringify(pkg));
};

export function initStorage(context: PluginContext) {
  const { storage } = context;

  async function resolveRepo(idOrName: string): Promise<any | null> {
    if (!idOrName || typeof context.getRepo !== 'function') return null;
    try {
      return await context.getRepo(idOrName);
    } catch {
      return null;
    }
  }

  async function handleGroupRead(
    repo: any,
    packageName: string,
    visited: Set<string>,
  ): Promise<any> {
    const members: string[] = repo.config?.members ?? [];
    if (!Array.isArray(members) || members.length === 0)
      return { ok: false, message: 'Not found' };

    const key = String(repo.id || repo.name || '');
    if (key) visited.add(key);

    for (const m of members) {
      const child = await resolveRepo(m);
      if (!child) continue;
      const childKey = String(child.id || child.name || '');
      if (childKey && visited.has(childKey)) continue;

      const res = await downloadImpl(child, packageName, visited);
      if (res?.ok) return res;
    }
    return { ok: false, message: 'Not found' };
  }

  async function handleProxyRead(repo: any, packageName: string): Promise<any> {
    let proxyFetchWithAuth;
    try {
      proxyFetchWithAuth =
        require('../../../../../plugins-core/proxy-helper').default;
    } catch (e) {
      console.warn('[HelmPlugin] Failed to load proxy-helper:', e);
      return { ok: false, message: 'Proxy helper missing' };
    }

    const upstream = repo.config?.url;
    if (!upstream) return { ok: false, message: 'No upstream URL' };

    const cleanUpstream = upstream.endsWith('/')
      ? upstream.slice(0, -1)
      : upstream;
    const targetUrl = `${cleanUpstream}/${packageName}`;
    const proxyKey = buildKey('helm', repo.id, 'proxy', packageName);

    // Locking & Coalescing
    const lockKey = `helm:${repo.id}:${packageName}`;
    return await runWithLock(context, lockKey, async () => {
      try {
        const cached = await storage.get(proxyKey);
        if (cached)
          return {
            ok: true,
            data: cached,
            contentType: 'application/octet-stream',
          };
      } catch { }

      try {
        const res = await proxyFetchWithAuth(repo, targetUrl);
        if (res.ok && res.body) {
          const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
          if (cacheMaxAgeDays > 0) {
            await storage.save(proxyKey, res.body);
            if (context.indexArtifact && packageName.endsWith('.tgz')) {
              try {
                await context.indexArtifact(repo, {
                  ok: true,
                  id: packageName,
                  metadata: {
                    storageKey: proxyKey,
                    size: res.body.length,
                    path: packageName,
                  },
                });
              } catch { }
            }
          }
          return {
            ok: true,
            data: res.body,
            contentType:
              res.headers?.['content-type'] || 'application/octet-stream',
          };
        }
      } catch { }
      return { ok: false, message: 'Not found' };
    });
  }


  async function downloadImpl(
    repo: any,
    packageName: string,
    visited: Set<string>,
  ): Promise<any> {
    if (!repo) return { ok: false, message: 'Not found' };

    if (repo.type === 'group')
      return handleGroupRead(repo, packageName, visited);

    if (packageName === 'index.yaml') {
      const key = buildKey('helm', repo.id, 'index.yaml');
      try {
        const content = await storage.get(key);
        return { ok: true, data: content, contentType: 'application/x-yaml' };
      } catch { }
    }

    if (repo.type === 'proxy') return handleProxyRead(repo, packageName);

    const key = buildKey('helm', repo.id, packageName);
    if (await storage.exists(key)) {
      const content = await storage.get(key);
      return { ok: true, data: content, contentType: 'application/gzip' };
    }

    return { ok: false, message: 'Not found' };
  }

  async function updateIndexYaml(repo: any, pkg: any, filename: string) {
    const repoId = repo.id;
    const lockKey = `helm:index:${repoId}`;

    return await runWithLock(context, lockKey, async () => {
      const indexKey = buildKey('helm', repo.id, 'index.yaml');
      let index: any = { apiVersion: 'v1', entries: {} };

      try {
        const existing = await storage.get(indexKey);
        if (existing) {
          index = yaml.load(existing.toString());
        }
      } catch { }

      const name = pkg.name || 'unknown';
      const version = pkg.version || '0.0.0';

      if (!index.entries[name]) index.entries[name] = [];

      const existingVersion = index.entries[name].find(
        (e: any) => e.version === version,
      );
      if (!existingVersion) {
        index.entries[name].push({
          apiVersion: 'v2',
          name,
          version,
          urls: [filename],
          created: new Date().toISOString(),
        });
      }

      const buf = Buffer.from(yaml.dump(index));
      await storage.save(indexKey, buf);
    });
  }

  async function handleGroupUpload(
    repo: any,
    pkg: any,
    uploadFn: (r: any, p: any) => Promise<any>,
  ): Promise<any> {
    const writePolicy = repo.config?.writePolicy || 'none';
    const members = repo.config?.members || [];

    if (writePolicy === 'none')
      return { ok: false, message: 'Group is read-only' };

    const getHostedMembers = async () => {
      const hosted: any[] = [];
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

    if (writePolicy === 'preferred') {
      const preferredId = repo.config?.preferredWriter;
      if (!preferredId)
        return { ok: false, message: 'Preferred writer not configured' };
      const member = await resolveRepo(preferredId);
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
          message: 'Mirror upload failed',
        }
      );
    }

    return { ok: false, message: 'Unknown write policy' };
  }

  const upload = async (repo: any, pkg: any): Promise<any> => {
    if (repo.type === 'group') return handleGroupUpload(repo, pkg, upload);

    const buf = getBufferFromPackage(pkg);
    const filename = pkg.filename || `${pkg.name}-${pkg.version}.tgz`;
    const key = buildKey('helm', repo.id, filename);

    const result = await storage.save(key, buf);
    await updateIndexYaml(repo, pkg, filename);

    const uploadResult = {
      ok: true,
      id: filename,
      metadata: {
        name: pkg.name || 'unknown',
        version: pkg.version || '0.0.0',
        storageKey: key,
        size: result.size ?? buf.length,
        contentHash: result.contentHash,
      },
    };

    // Index artifact in DB for UI listing
    if (context.indexArtifact) {
      try {
        await context.indexArtifact(repo, uploadResult);
      } catch (e) {
        console.error('[Helm] Failed to index artifact:', e);
      }
    }

    return uploadResult;
  };

  const handlePut = async (repo: any, filePath: string, req: any) => {
    // Group Write Policy Logic
    if (repo.type === 'group') {
      const writePolicy = repo.config?.writePolicy || 'none';
      const members = repo.config?.members || [];

      if (writePolicy === 'none') {
        return { ok: false, message: 'Group is read-only' };
      }

      const getHostedMembers = async () => {
        const hosted: any[] = [];
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
      // Ensure specific fields required by handlePut for buffer detection are present if needed
      // but passing body/buffer usually suffices.

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await handlePut(member, filePath, delegateReq);
          if (result.ok) return result;
        }
        return { ok: false, message: 'No writable member found' };
      }

      if (writePolicy === 'preferred') {
        const preferredId = repo.config?.preferredWriter;
        if (!preferredId)
          return { ok: false, message: 'Preferred writer not configured' };
        const member = await resolveRepo(preferredId);
        if (!member || member.type !== 'hosted')
          return { ok: false, message: 'Preferred writer unavailable' };
        return await handlePut(member, filePath, delegateReq);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(
          hosted.map((m) => handlePut(m, filePath, delegateReq)),
        );
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }
    if (
      filePath.endsWith('.tgz') &&
      typeof storage.saveStream === 'function' &&
      !req.body &&
      !req.buffer
    ) {
      const key = buildKey('helm', repo.id, filePath);
      try {
        const result = await storage.saveStream(key, req);

        // FIX: Update index.yaml for streaming uploads too
        await updateIndexYaml(repo, {
          name: filePath.replace(/-[0-9]+\.[0-9]+\.[0-9]+\.tgz$/, ''), // best effort name extraction
          version: (filePath.match(/-([0-9]+\.[0-9]+\.[0-9]+)\.tgz$/) || [])[1] || '0.0.0',
          filename: filePath
        }, filePath);

        return {
          ok: true,
          id: filePath,
          metadata: {
            storageKey: key,
            size: result.size,
            contentHash: result.contentHash,
          },
        };
      } catch (err: any) {
        return { ok: false, message: String(err) };
      }
    }

    let buf: Buffer;
    if (Buffer.isBuffer(req.body)) {
      buf = req.body;
    } else if (req.body && typeof req.body === 'object') {
      buf = Buffer.from(JSON.stringify(req.body));
    } else if (req.body) {
      buf = Buffer.from(String(req.body));
    } else {
      const chunks: any[] = [];
      for await (const chunk of req) chunks.push(chunk);
      buf = Buffer.concat(chunks);
    }

    return upload(repo, { buffer: buf, filename: filePath });
  };

  return {
    upload,
    handlePut,
    download: (repo: any, packageName: string) =>
      downloadImpl(repo, packageName, new Set()),
  };
}
