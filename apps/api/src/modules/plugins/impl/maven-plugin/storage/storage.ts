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
import { parseMavenCoordsFromPath, normalizeRepoPath } from '../utils/maven';
import * as crypto from 'crypto';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

// normalizeRepoPath imported from utils/maven
// parseMavenCoordsFromPath imported from utils/maven

function isProbablyBase64(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 16) return false;
  if (trimmed.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
}

function getContentBuffer(pkg: any): Buffer {
  if (pkg?.buffer && Buffer.isBuffer(pkg.buffer)) return pkg.buffer;
  if (pkg?.buffer?.type === 'Buffer' && Array.isArray(pkg.buffer.data)) {
    return Buffer.from(pkg.buffer.data);
  }

  const raw = pkg?.content ?? pkg?.data;

  if (pkg?.encoding === 'base64' && typeof raw === 'string') {
    return Buffer.from(raw, 'base64');
  }

  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string') {
    if (isProbablyBase64(raw)) {
      try {
        const decoded = Buffer.from(raw, 'base64');
        const re = decoded.toString('base64').replace(/=+$/, '');
        const inNorm = raw.trim().replace(/=+$/, '');
        if (re === inNorm) return decoded;
      } catch {
        // fallthrough
      }
    }
    return Buffer.from(raw);
  }
  return Buffer.from(JSON.stringify(pkg ?? {}));
}

function getContentTypeByPath(p: string): string {
  const lower = p.toLowerCase();
  if (lower.endsWith('.pom') || lower.endsWith('.xml'))
    return 'application/xml';
  if (lower.endsWith('.jar')) return 'application/java-archive';
  if (lower.endsWith('.aar')) return 'application/octet-stream';
  if (
    lower.endsWith('.sha1') ||
    lower.endsWith('.md5') ||
    lower.endsWith('.sha256')
  )
    return 'text/plain';
  if (lower.endsWith('.asc')) return 'application/pgp-signature';
  return 'application/octet-stream';
}

function checksumAlgoForPath(p: string): 'sha1' | 'md5' | 'sha256' | null {
  const lower = p.toLowerCase();
  if (lower.endsWith('.sha1')) return 'sha1';
  if (lower.endsWith('.md5')) return 'md5';
  if (lower.endsWith('.sha256')) return 'sha256';
  return null;
}

function stripChecksumExt(p: string): string {
  if (p.toLowerCase().endsWith('.sha1')) return p.slice(0, -5);
  if (p.toLowerCase().endsWith('.md5')) return p.slice(0, -4);
  if (p.toLowerCase().endsWith('.sha256')) return p.slice(0, -7);
  return p;
}

async function streamToBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    req.on('data', (c: Buffer) =>
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
    );
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function initStorage(context: PluginContext) {
  const { storage } = context;

  async function resolveRepo(id: string): Promise<Repository | null> {
    if (!id) return null;
    if (typeof context.getRepo !== 'function') return null;
    try {
      return (await context.getRepo(id)) as any;
    } catch {
      return null;
    }
  }

  async function downloadImpl(
    repo: Repository,
    repoPath: string,
    visited: Set<string>,
  ): Promise<any> {
    if (!repo) return { ok: false, message: 'Not found' };
    const p = normalizeRepoPath(repoPath);

    // Group read: try members in order
    if (repo.type === 'group') {
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

        const res = await downloadImpl(child as any, p, visited);
        if (res?.ok) return res;
      }
      return { ok: false, message: 'Not found' };
    }

    if (repo.type === 'proxy') {
      const { initProxy } = require('../proxy/fetch');
      const { proxyFetch } = initProxy(context);
      const proxyKey = buildKey('maven', repo.id, 'proxy', p);

      try {
        // Coalescing & Locking
        const lockKey = `maven:${repo.id}:${p}`;
        return await runWithLock(context, lockKey, async () => {
          const cached = await storage.get(proxyKey);
          if (cached) {
            return {
              ok: true,
              data: cached,
              contentType: getContentTypeByPath(p),
            };
          }

          const proxied = await proxyFetch(repo as any, p);
          if (proxied?.ok && proxied.body) {
            const cacheMaxAgeDays = repo.config?.cacheMaxAgeDays ?? 7;
            if (cacheMaxAgeDays > 0) {
              await storage.save(proxyKey, proxied.body);

              // Index artifact if it's a jar/pom/aar
              if (
                context.indexArtifact &&
                (p.endsWith('.jar') || p.endsWith('.pom') || p.endsWith('.aar'))
              ) {
                try {
                  const coords = parseMavenCoordsFromPath(p);
                  if (coords) {
                    await context.indexArtifact(repo, {
                      ok: true,
                      id: p,
                      metadata: {
                        name: coords.packageName,
                        version: coords.version,
                        path: p,
                        storageKey: proxyKey,
                        size: proxied.body.length,
                      },
                    });
                  }
                } catch (e) {
                  // ignore
                }
              }
            }
            return {
              ok: true,
              data: proxied.body,
              contentType:
                proxied.headers?.['content-type'] || getContentTypeByPath(p),
            };
          }
          return { ok: false, message: 'Not found in upstream' };
        });
      } catch (err) {
        // ignore
      }
    }

    // Hosted read
    const storageKeyId = buildKey('maven', repo.id, p);
    const storageKeyName = buildKey('maven', repo.name, p);

    // Checksums: serve stored checksum if present, else compute from base artifact.
    const algo = checksumAlgoForPath(p);
    if (algo) {
      try {
        let existing = await storage.get(storageKeyId).catch(() => null);
        if (!existing) existing = await storage.get(storageKeyName).catch(() => null);
        if (existing) {
          return { ok: true, data: existing, contentType: 'text/plain' };
        }
      } catch {
        // ignore
      }

      const basePath = stripChecksumExt(p);
      const baseKeyId = buildKey('maven', repo.id, basePath);
      const baseKeyName = buildKey('maven', repo.name, basePath);
      try {
        let base = await storage.get(baseKeyId).catch(() => null);
        if (!base) base = await storage.get(baseKeyName).catch(() => null);
        if (!base) return { ok: false, message: 'Not found' };
        const sum = crypto.createHash(algo).update(base).digest('hex') + '\n';
        return { ok: true, data: Buffer.from(sum), contentType: 'text/plain' };
      } catch {
        return { ok: false, message: 'Not found' };
      }
    }

    try {
      let data = await storage.get(storageKeyId).catch(() => null);
      if (!data) data = await storage.get(storageKeyName).catch(() => null);
      if (!data) return { ok: false, message: 'Not found' };
      return {
        ok: true,
        data,
        contentType: getContentTypeByPath(p),
      };
    } catch {
      return { ok: false, message: 'Not found' };
    }
  }

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

    // Hosted upload: prefer explicit maven repo relative path.
    const repoPath = normalizeRepoPath(
      pkg?.path || pkg?.name || 'com/example/artifact/1.0.0/artifact-1.0.0.pom',
    );
    const keyId = buildKey('maven', repo.id, repoPath);
    const keyName = buildKey('maven', repo.name, repoPath);
    const buf = getContentBuffer(pkg);

    const coords = parseMavenCoordsFromPath(repoPath);
    const packageName =
      coords?.packageName ||
      pkg?.packageName ||
      pkg?.coordinates ||
      'com.example:artifact';
    const version = coords?.version || pkg?.version || '1.0.0';

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    const isSnapshot = String(version).toUpperCase().endsWith('-SNAPSHOT');
    const isMetadataOrChecksum =
      repoPath.toLowerCase().endsWith('maven-metadata.xml') ||
      checksumAlgoForPath(repoPath) !== null ||
      repoPath.toLowerCase().endsWith('.asc');
    if (!allowRedeploy && !isSnapshot && !isMetadataOrChecksum) {
      const existsId = await storage.exists(keyId);
      const existsName = await storage.exists(keyName);
      if (existsId || existsName) {
        return {
          ok: false,
          message: `Redeployment of ${packageName}:${version} is not allowed`,
        };
      }
    }

    try {
      await storage.save(keyId, buf);
      const uploadResult = {
        ok: true,
        id: repoPath,
        metadata: {
          name: packageName,
          version,
          path: repoPath,
          storageKey: keyId,
          size: buf.length,
        },
      };

      // Index artifact in DB for UI listing (skip metadata/checksums)
      if (
        context.indexArtifact &&
        !isMetadataOrChecksum &&
        packageName &&
        version
      ) {
        try {
          await context.indexArtifact(repo, uploadResult);
        } catch (e) {
          console.error('[Maven] Failed to index artifact:', e);
        }
      }

      return uploadResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const download = async (repo: Repository, name: string, version?: string) => {
    // In the HTTP controller, Maven uses name as the repo-relative path.
    return downloadImpl(repo, name, new Set());
  };

  const handlePut = async (repo: Repository, repoPath: string, req: any) => {
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
        buf = await streamToBuffer(req);
      }
      const delegateReq = { body: buf };

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          try {
            const result = await handlePut(member, repoPath, delegateReq);
            if (result.ok) return result;
          } catch (e) {
            // ignore and try next
          }
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
        return await handlePut(member, repoPath, delegateReq);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(
          hosted.map((m) => handlePut(m, repoPath, delegateReq)),
        );
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    const p = normalizeRepoPath(repoPath);
    const key = buildKey('maven', repo.id, p);

    const coords = parseMavenCoordsFromPath(p);
    const packageName = coords?.packageName;
    const version = coords?.version;

    const allowRedeploy = repo.config?.allowRedeploy !== false;
    const isSnapshot = version
      ? String(version).toUpperCase().endsWith('-SNAPSHOT')
      : false;
    const isMetadataOrChecksum =
      p.toLowerCase().endsWith('maven-metadata.xml') ||
      checksumAlgoForPath(p) !== null ||
      p.toLowerCase().endsWith('.asc');

    if (!allowRedeploy && version && !isSnapshot && !isMetadataOrChecksum) {
      const exists = await storage.exists(key);
      if (exists) {
        throw new Error(
          `Redeployment of ${packageName || ''}:${version} is not allowed`,
        );
      }
    }

    let result: any;
    if (typeof storage.saveStream === 'function' && !req.body && !req.buffer) {
      // Use streaming if available and body not already parsed
      result = await storage.saveStream(key, req);
    } else {
      let buf: Buffer;
      if (req.body && Buffer.isBuffer(req.body)) {
        buf = req.body;
      } else if (req.buffer && Buffer.isBuffer(req.buffer)) {
        buf = req.buffer;
      } else if (typeof req.body === 'string') {
        buf = Buffer.from(req.body);
      } else if (
        req.body &&
        typeof req.body === 'object' &&
        Object.keys(req.body).length > 0
      ) {
        throw new Error(
          'Body already parsed. Please use Content-Type: application/octet-stream or similar.',
        );
      } else {
        buf = await streamToBuffer(req);
      }
      await storage.save(key, buf);
      result = { ok: true, size: buf.length };
    }

    const putResult = {
      ok: true,
      id: p,
      metadata: {
        name: packageName,
        version,
        path: p,
        storageKey: key,
        size: result.size,
        contentHash: result.contentHash,
      },
    };

    // Index artifact in DB for UI listing (skip metadata/checksums)
    if (
      context.indexArtifact &&
      !isMetadataOrChecksum &&
      packageName &&
      version
    ) {
      try {
        await context.indexArtifact(repo, putResult);
      } catch (e) {
        console.error('[Maven] Failed to index artifact:', e);
      }
    }

    return putResult;
  };

  return { upload, download, handlePut };
}
