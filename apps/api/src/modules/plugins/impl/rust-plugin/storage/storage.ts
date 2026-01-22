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
import * as crypto from 'crypto';
import * as toml from '@iarna/toml';
import * as tar from 'tar-stream';
import * as zlib from 'zlib';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

export function initStorage(context: PluginContext) {
  const { storage } = context;

  const getSha256 = (buf: Buffer) =>
    crypto.createHash('sha256').update(buf).digest('hex');

  const getIndexPath = (name: string) => {
    const lower = name.toLowerCase();
    const len = lower.length;
    if (len === 1) return `1/${lower}`;
    if (len === 2) return `2/${lower}`;
    if (len === 3) return `3/${lower.substring(0, 1)}/${lower}`;
    return `${lower.substring(0, 2)}/${lower.substring(2, 4)}/${lower}`;
  };

  const parseCrateMetadata = async (buf: Buffer): Promise<any> => {
    return new Promise<any>((resolve) => {
      const extract = tar.extract();
      let cargoData: any = null;

      extract.on('entry', (header, stream, next) => {
        if (header.name.endsWith('Cargo.toml')) {
          const chunks: Buffer[] = [];
          stream.on('data', (c) => chunks.push(c));
          stream.on('end', () => {
            try {
              cargoData = toml.parse(Buffer.concat(chunks).toString('utf-8'));
            } catch { }
            next();
          });
        } else {
          stream.on('end', next);
          stream.resume();
        }
      });

      extract.on('finish', () => resolve(cargoData || {}));
      extract.on('error', () => resolve({}));

      try {
        const gunzip = zlib.createGunzip();
        gunzip.on('error', () => resolve({}));
        gunzip.pipe(extract);
        gunzip.end(buf);
      } catch {
        resolve({});
      }
    });
  };

  const mapDependencies = (cargo: any) => {
    const deps: any[] = [];
    const kinds = [
      { key: 'dependencies', kind: 'normal' },
      { key: 'dev-dependencies', kind: 'dev' },
      { key: 'build-dependencies', kind: 'build' },
    ];

    for (const { key, kind } of kinds) {
      if (cargo[key]) {
        for (const [name, val] of Object.entries(cargo[key])) {
          let req = '*';
          let features: string[] = [];
          let optional = false;
          let default_features = true;
          const target = null;
          if (typeof val === 'string') {
            req = val;
          } else if (typeof val === 'object' && val !== null) {
            const v = val as any;
            req = v.version || '*';
            features = v.features || [];
            optional = !!v.optional;
            if (v.default_features === false) default_features = false;
          }
          deps.push({
            name,
            req,
            features,
            optional,
            default_features,
            target,
            kind,
            package: null,
          });
        }
      }
    }
    return deps;
  };

  const updateIndex = async (
    repo: Repository,
    name: string,
    version: string,
    buf: Buffer,
    meta: any,
  ) => {
    const repoId = repo.id;
    const lockKey = `rust:index:${repoId}`;

    return await runWithLock(context, lockKey, async () => {
      const relPath = getIndexPath(name);
      const key = buildKey('rust', repo.id, 'index', relPath);

      let finalDeps = meta.deps;
      let finalFeatures = meta.features;
      if (!finalDeps || !finalFeatures) {
        const cargo = await parseCrateMetadata(buf);
        if (cargo) {
          if (!finalDeps) finalDeps = mapDependencies(cargo);
          if (!finalFeatures) finalFeatures = cargo.features || {};
        }
      }

      const entry = {
        name,
        vers: version,
        deps: finalDeps || [],
        cksum: getSha256(buf),
        features: finalFeatures || {},
        yanked: false,
        links: meta.links || undefined,
      };
      const line = JSON.stringify(entry);

      let content = '';
      try {
        const existing = await storage.get(key).catch(() => null);
        if (existing) content = existing.toString() + '\n';
      } catch { }

      if (!content.includes(`"vers":"${version}"`)) {
        content += line;
        await storage.save(key, Buffer.from(content));
      }
    });
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

    const name = pkg?.name || 'crate';
    const version = pkg?.version || '0.1.0';
    const fileName = `${name}-${version}.crate`;
    const keyId = buildKey('rust', repo.id, 'crates', name, version, fileName);

    let buf: Buffer;
    if (pkg?.encoding === 'base64' && typeof pkg.content === 'string')
      buf = Buffer.from(pkg.content, 'base64');
    else
      buf = Buffer.isBuffer(pkg.content || pkg.buffer)
        ? pkg.content || pkg.buffer
        : Buffer.from(String(pkg.content || pkg.buffer || ''));

    if (repo.config?.allowRedeploy === false) {
      if (await storage.exists(keyId).catch(() => false))
        return { ok: false, message: `Redeployment not allowed` };
    }

    try {
      const result = await storage.save(keyId, buf);
      await updateIndex(repo, name, version, buf, pkg);

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
          console.error('[Rust] Failed to index artifact:', e);
        }
      }

      return uploadResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    let buf: Buffer;
    if (
      req.body &&
      (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))
    ) {
      if (Buffer.isBuffer(req.body)) buf = req.body;
      else if (typeof req.body === 'object')
        buf = Buffer.from(JSON.stringify(req.body));
      else buf = Buffer.from(String(req.body));
    } else {
      const chunks: any[] = [];
      for await (const chunk of req) chunks.push(chunk);
      buf = Buffer.concat(chunks);
    }
    let name = 'crate';
    let version = '0.0.0';
    const filename = path.split('/').pop() || '';
    const match = filename.match(/^(.*)-(\d+\.\d+\.\d+.*)\.crate$/);
    if (match) {
      name = match[1];
      version = match[2];
    }
    return upload(repo, { content: buf, name, version });
  };

  const proxyDownload = async (
    repo: Repository,
    url: string,
    name: string,
    version: string,
  ) => {
    const cleanVersion = version.split('?')[0].split('#')[0];
    const keyId = buildKey(
      'rust',
      repo.id,
      'proxy',
      name,
      cleanVersion,
      `${name}-${cleanVersion}.crate`,
    );
    const cacheEnabled = repo.config?.cacheEnabled !== false;

    // Locking & Coalescing
    const lockKey = `rust:${repo.id}:${name}:${version}`;
    return await runWithLock(context, lockKey, async () => {
      const existing = cacheEnabled ? await storage.get(keyId).catch(() => null) : null;
      if (existing) return { ok: true, data: existing, skipCache: true };

      let proxyFetchWithAuth;
      try {
        proxyFetchWithAuth =
          require('../../../../../plugins-core/proxy-helper').default;
      } catch {
        throw new Error('Proxy helper missing');
      }

      const response = await proxyFetchWithAuth(repo, url);
      if (!response.ok) return response;
      const buf = Buffer.isBuffer(response.body)
        ? response.body
        : Buffer.from(response.body || '');
      if (
        buf.length > 0 &&
        cacheEnabled &&
        (repo.config?.cacheMaxAgeDays ?? 7) > 0
      ) {
        await storage.save(keyId, buf);
        if (context.indexArtifact) {
          try {
            await context.indexArtifact(repo, {
              ok: true,
              id: `${name}:${cleanVersion}`,
              metadata: {
                name,
                version: cleanVersion,
                storageKey: keyId,
                size: buf.length,
              },
            });
          } catch { }
        }
      }
      return { ok: true, data: buf, contentType: 'application/octet-stream' };
    });
  };

  const download = async (
    repo: Repository,
    name: string,
    version?: string,
  ): Promise<any> => {
    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      if (!context.getRepo) return { ok: false, message: 'Context not ready' };
      for (const id of members) {
        try {
          const m = await context.getRepo(id);
          if (m) {
            const res = await download(m, name, version);
            if (res.ok) return res;
          }
        } catch { }
      }
      return { ok: false, message: 'Not found in group' };
    }
    if (name === 'config.json') {
      const host = process.env.API_HOST || 'localhost:3000';
      const proto = process.env.API_PROTOCOL || 'http';
      const baseUrl = `${proto}://${host}/repository/${repo.name}`;
      return {
        ok: true,
        contentType: 'application/json',
        data: Buffer.from(
          JSON.stringify({
            dl: baseUrl + '/crates/{crate}/{version}/download',
            api: baseUrl,
          }),
        ),
      };
    }
    if (!version && !name.endsWith('.crate') && name !== 'download') {
      // Handle "index/" prefix if present
      const indexPath = name.startsWith('index/') ? name.substring(6) : name;
      const key = buildKey('rust', repo.id, 'index', indexPath);
      try {
        const data = await storage.get(key).catch(() => null);
        if (data) return { ok: true, data, contentType: 'text/plain' };
      } catch { }
    }
    if (repo.type === 'proxy') {
      const upstream = repo.config?.proxyUrl || repo.config?.url;
      if (!upstream)
        return { ok: false, message: 'No upstream URL configured' };
      const cleanUpstream = upstream.endsWith('/')
        ? upstream.slice(0, -1)
        : upstream;
      const targetUrl = `${cleanUpstream}/${name}/${version}/download`;
      return proxyDownload(repo, targetUrl, name, version!);
    }
    if (!version && name.includes('/')) {
      const parts = name.split('/');
      if (parts.length >= 2) {
        name = parts[0];
        version = parts[1];
      }
      if (parts[0] === 'crates' && parts.length >= 3) {
        name = parts[1];
        version = parts[2];
      }
    }
    if (!version) return { ok: false, message: 'Version required' };
    const fileName = `${name}-${version}.crate`;
    const keyId = buildKey('rust', repo.id, 'crates', name, version, fileName);
    try {
      let data = await storage.get(keyId).catch(() => null);
      if (!data)
        data = await storage.get(
          buildKey('rust', repo.id, name, version, fileName),
        ).catch(() => null);
      if (!data) return { ok: false, message: 'Not found' };
      return { ok: true, data, contentType: 'application/octet-stream' };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { upload, download, handlePut, proxyDownload };
}
