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

    // For raw, we might just take the file content and a path
    const name = pkg?.name || 'file.txt';
    const version = pkg?.version || 'latest'; // Raw doesn't strictly have versions, but we can use it for pathing
    const key = buildKey('raw', repo.id, name); // Raw usually doesn't version in the key like others? Or maybe it does.
    // The original raw plugin didn't implement upload, but let's add a basic one.
    // Wait, the original raw plugin DID NOT implement upload.
    // But the user wants me to implement the plugins based on what we have.
    // I'll add a basic upload.

    const data = pkg?.content ?? JSON.stringify(pkg ?? {});
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const existing = await storage.get(key);
      if (existing) {
        return { ok: false, message: `Redeployment of ${name} is not allowed` };
      }
    }

    try {
      await storage.save(key, buf);
      return {
        ok: true,
        id: name,
        metadata: { name, version, storageKey: key, size: buf.length },
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    // Group Write Policy Logic for PUT
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
        // Mirroring streams is tricky because the stream is consumed.
        // We need to buffer it first.
        const chunks: any[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const buf = Buffer.concat(chunks);

        // Create a fake req object that yields the buffer
        const createReq = () => {
          const Readable = require('stream').Readable;
          const s = new Readable();
          s.push(buf);
          s.push(null);
          return s;
        };

        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };

        const results = await Promise.all(
          hosted.map((m) => handlePut(m, path, createReq())),
        );
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    // For raw, handlePut receives the path and the request object (stream)
    // We need to read the stream and save it.
    // But wait, the generic controller calls handlePut(repo, path, req)
    // And req is an express request, which is a readable stream.

    const name = path;
    const version = 'latest';
    const keyId = buildKey('raw', repo.id, name);
    const keyName = buildKey('raw', repo.name, name);

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const existingId = await storage.get(keyId);
      const existingName = await storage.get(keyName);
      if (existingId || existingName) {
        return { ok: false, message: `Redeployment of ${name} is not allowed` };
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
        // If body is already parsed by NestJS/Express
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
          // Read stream to buffer
          const chunks: any[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          buf = Buffer.concat(chunks);
        }

        await storage.save(keyId, buf);
        result = { ok: true, size: buf.length };
      }

      return {
        ok: true,
        id: name,
        metadata: {
          name,
          version,
          storageKey: keyId,
          size: result.size,
          contentHash: result.contentHash,
        },
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const download = async (repo: Repository, name: string, version?: string) => {
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

    // Raw download usually just by name (path)
    const storageKeyId = buildKey('raw', repo.id, name);

    try {
      let data = await storage.get(storageKeyId);
      if (!data) {
        const storageKeyName = buildKey('raw', repo.name, name);
        data = await storage.get(storageKeyName);
      }
      if (!data) return { ok: false, message: 'Not found' };
      return {
        ok: true,
        data,
        contentType: 'application/octet-stream',
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { upload, download, handlePut };
}
