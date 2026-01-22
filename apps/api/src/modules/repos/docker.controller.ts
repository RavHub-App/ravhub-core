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

import {
  Controller,
  Get,
  Put,
  Delete,
  Post,
  Param,
  Body,
  Req,
  Res,
  UnauthorizedException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import * as fs from 'fs';
import { ReposService } from './repos.service';
import { PluginManagerService } from '../plugins/plugin-manager.service';
import { StorageService } from '../storage/storage.service';
import { AuthService } from '../auth/auth.service';
import { RedisService } from '../redis/redis.service';
import { RepositoryEntity } from '../../entities/repository.entity';

@Controller('repository')
export class DockerCompatController {
  private readonly logger = new Logger(DockerCompatController.name);

  constructor(
    private repos: ReposService,
    private pluginManager: PluginManagerService,
    private auth: AuthService,
    private storage: StorageService,
    private redis: RedisService,
  ) { }

  private getUserIdFromRequest(req: any): string | undefined {
    try {
      // Check if req.user exists (set by auth guard)
      if (req?.user?.id) {
        return req.user.id;
      }

      // Extract from JWT token
      const ah = req?.headers?.authorization || req?.headers?.Authorization;
      if (ah && ah.startsWith('Bearer ')) {
        const token = ah.slice('Bearer '.length).trim();
        const payload: any = this.auth.verifyToken(token);
        if (payload?.sub || payload?.userId || payload?.id) {
          return payload.sub || payload.userId || payload.id;
        }
      }

      return undefined;
    } catch {
      return undefined;
    }
  }

  private async tokenAllows(req: any, name: string, action: 'pull' | 'push') {
    try {
      const ah = req?.headers?.authorization || req?.headers?.Authorization;

      // 1. Check for x-user-roles (Test/Mock fallback)
      const rolesHeader = req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
      if (rolesHeader) {
        const roles = String(rolesHeader).split(',').map((r: string) => r.trim().toLowerCase());
        const allowed = action === 'pull'
          ? roles.includes('reader') || roles.includes('admin') || roles.includes('user')
          : roles.includes('admin') || roles.includes('writer') || roles.includes('manager');
        if (allowed) return { allowed: true } as any;
      }

      if (!ah) return { allowed: false, reason: 'missing authorization' } as any;

      // 2. Check RavHub Admin roles from req.user (populated by guards)
      const user = (req as any).user;
      if (
        user?.username === 'admin' ||
        user?.username === 'superadmin' ||
        user?.roles?.some((r: any) => ['admin', 'superadmin'].includes(String(r.name || r).toLowerCase()))
      ) {
        return { allowed: true } as any;
      }

      if (!ah.startsWith('Bearer ')) {
        return { allowed: false, reason: 'invalid auth type' } as any;
      }

      const token = ah.slice('Bearer '.length).trim();
      let payload: any;
      try {
        const jwt = require('jsonwebtoken');
        payload = jwt.verify(token, process.env.JWT_SECRET || 'changeme');
      } catch (err: any) {
        return { allowed: false, reason: `token Verification failed: ${err.message}` } as any;
      }

      if (!payload) {
        return { allowed: false, reason: 'invalid token (null payload)' } as any;
      }

      // 3. Check roles in payload (RavHub token fallback)
      if (payload.roles?.some((r: any) => ['admin', 'superadmin'].includes(String(r).toLowerCase()))) {
        return { allowed: true } as any;
      }

      // 4. Check Docker-specific scopes
      const access = payload.access || payload.scopes || payload.scope;
      if (!access) {
        return { allowed: false, reason: `no scopes in token: ${JSON.stringify(payload)}` } as any;
      }

      const cleanName = String(name).trim();
      const cleanAction = String(action).trim().toLowerCase();

      for (const a of access) {
        const aType = String(a.type).trim().toLowerCase();
        const aName = String(a.name).trim();
        const aActions = Array.isArray(a.actions) ? a.actions.map((act: any) => String(act).trim().toLowerCase()) : [];

        if (aType === 'repository' && aName === cleanName) {
          if (aActions.includes(cleanAction)) {
            return { allowed: true } as any;
          }
        }
      }

      return {
        allowed: false,
        reason: `insufficient scope: required={repository, ${cleanName}, ${cleanAction}}, got=${JSON.stringify(access)}`
      } as any;
    } catch (err: any) {
      return { allowed: false, reason: `internal error: ${err.message}` } as any;
    }
  }

  private buildAuthChallenge(
    req: any,
    repoId: string,
    name: string,
    action: string,
  ) {
    const apiBase =
      process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    const realm = `${apiBase.replace(/\/$/, '')}/repository/${repoId}/v2/token`;
    // service is the host header if present otherwise generic 'docker'
    const service = (req?.headers?.host as string) || 'docker';
    const scope = `repository:${name}:${action}`;
    return `Bearer realm="${realm}",service="${service}",scope="${scope}"`;
  }

  private fastAllowFromRoles(req: any, forAction: 'push' | 'pull') {
    const rolesHeader =
      req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
    if (!rolesHeader) return false;
    const roles = String(rolesHeader)
      .split(',')
      .map((r: string) => r.trim().toLowerCase());
    if (forAction === 'pull') {
      return (
        roles.includes('reader') ||
        roles.includes('admin') ||
        roles.includes('user')
      );
    }
    // for push operations require admin/writer/manager
    return (
      roles.includes('admin') ||
      roles.includes('writer') ||
      roles.includes('manager')
    );
  }

  // Docker session helpers for Redis (distributed) or in-memory (singleton)
  private async getSess(uuid: string): Promise<any> {
    if (this.redis.isEnabled()) {
      const data = await this.redis.get(`docker:sess:${uuid}`);
      if (!data) return null;
      const parsed = JSON.parse(data);
      if (parsed.buffers) {
        parsed.buffers = parsed.buffers.map((b: any) =>
          Buffer.from(b, 'base64'),
        );
      }
      return parsed;
    }
    return this.uploadSessions.get(uuid);
  }

  private async setSess(uuid: string, sess: any): Promise<void> {
    if (this.redis.isEnabled()) {
      const toStore = { ...sess };
      if (toStore.buffers) {
        toStore.buffers = toStore.buffers.map((b: Buffer) =>
          b.toString('base64'),
        );
      }
      // TTL 24h for uploads
      await this.redis.set(
        `docker:sess:${uuid}`,
        JSON.stringify(toStore),
        86400,
      );
      return;
    }
    this.uploadSessions.set(uuid, sess);
  }

  private async delSess(uuid: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(`docker:sess:${uuid}`);
      return;
    }
    this.uploadSessions.delete(uuid);
  }

  // simple in-memory sessions store for multipart uploads (uuid -> {buffers, size})
  private uploadSessions: Map<
    string,
    { buffers: Buffer[]; size: number; repoId: string; name: string }
  > = new Map();

  // registry root check
  @Get(':id/v2/')
  async ping(@Param('id') id: string) {
    const r = await this.repos.findOne(id);
    if (!r) return { ok: false };
    return { ok: true };
  }

  // Docker token endpoint (token service). This must live on the docker compat controller,
  // not the generic repositories controller.
  @Get(':id/v2/token')
  @Post(':id/v2/token')
  async token(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const r = await this.repos.findOne(id);
    if (!r) throw new NotFoundException('not found');

    const scopeParam =
      req?.query?.scope || body?.scope || req?.query?.scopes || body?.scopes;
    const rawScopes =
      typeof scopeParam === 'string' && scopeParam.length
        ? String(scopeParam).split(' ')
        : [];

    // For tests/dev: if x-user-roles header is present, mint a token directly.
    const rolesHeader =
      req?.headers?.['x-user-roles'] || req?.headers?.['x-user-role'];
    if (rolesHeader) {
      const roles = String(rolesHeader)
        .split(',')
        .map((rr: string) => rr.trim().toLowerCase())
        .filter(Boolean);

      const requestedAccess: Array<{
        type: string;
        name: string;
        actions: string[];
      }> = [];
      for (const rs of rawScopes) {
        const parts = String(rs).split(':');
        if (parts.length >= 3) {
          const type = parts[0];
          const name = parts.slice(1, parts.length - 1).join(':');
          const actions = parts[parts.length - 1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          requestedAccess.push({ type, name, actions });
        }
      }

      const token = this.auth.signToken({
        sub: 'test-user',
        username: 'test-user',
        roles,
        access: requestedAccess,
      });

      return {
        token,
        access_token: token,
        expires_in: 3600,
        issued_at: new Date().toISOString(),
      };
    }

    const authHeader =
      req?.headers?.authorization || req?.headers?.Authorization;

    if (authHeader && String(authHeader).startsWith('Bearer ')) {
      const token = String(authHeader).slice('Bearer '.length).trim();
      try {
        const payload: any = this.auth.verifyToken(token);
        if (payload) {
          const username = payload.username || payload.sub || 'test-user';
          const requestedAccess: Array<{
            type: string;
            name: string;
            actions: string[];
          }> = [];
          for (const rs of rawScopes) {
            const parts = String(rs).split(':');
            if (parts.length >= 3) {
              const type = parts[0];
              const name = parts.slice(1, parts.length - 1).join(':');
              const actions = parts[parts.length - 1]
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
              requestedAccess.push({ type, name, actions });
            }
          }
          const token = this.auth.signToken({
            sub: username,
            username,
            access: requestedAccess,
          });
          return {
            token,
            access_token: token,
            expires_in: 3600,
            issued_at: new Date().toISOString(),
          };
        }
      } catch (e: any) {
        // Silently fail and fallback to Basic auth if Bearer token is invalid
      }
    }

    if (!authHeader || !String(authHeader).startsWith('Basic ')) {
      // If repository is public, allow anonymous token for 'pull' actions
      if (r.config?.authEnabled === false) {
        const requestedAccess: Array<{
          type: string;
          name: string;
          actions: string[];
        }> = [];
        let allPull = true;
        for (const rs of rawScopes) {
          const parts = String(rs).split(':');
          if (parts.length >= 3) {
            const type = parts[0];
            const name = parts.slice(1, parts.length - 1).join(':');
            const actions = parts[parts.length - 1]
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);

            if (actions.some((a) => a !== 'pull')) {
              allPull = false;
            }
            requestedAccess.push({
              type,
              name,
              actions: actions.filter((a) => a === 'pull'),
            });
          }
        }

        if (allPull && requestedAccess.length > 0) {
          const token = this.auth.signToken({
            sub: 'anonymous',
            username: 'anonymous',
            roles: ['reader'],
            access: requestedAccess,
          });

          return {
            token,
            access_token: token,
            expires_in: 3600,
            issued_at: new Date().toISOString(),
          };
        }
      }
      throw new UnauthorizedException('basic auth required');
    }

    let username = '';
    let password = '';
    try {
      const decoded = Buffer.from(
        String(authHeader).slice('Basic '.length),
        'base64',
      ).toString('utf8');
      const idx = decoded.indexOf(':');
      username = idx >= 0 ? decoded.slice(0, idx) : decoded;
      password = idx >= 0 ? decoded.slice(idx + 1) : '';
    } catch (err: any) {
      throw new UnauthorizedException('invalid basic auth');
    }

    const validated = await this.auth.validateUser(username, password);
    if (!validated) throw new UnauthorizedException('invalid credentials');

    const requestedAccess: Array<{
      type: string;
      name: string;
      actions: string[];
    }> = [];
    for (const rs of rawScopes) {
      const parts = String(rs).split(':');
      if (parts.length >= 3) {
        const type = parts[0];
        const name = parts.slice(1, parts.length - 1).join(':');
        const actions = parts[parts.length - 1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        requestedAccess.push({ type, name, actions });
      }
    }

    const tokenPayload = {
      sub: username,
      username,
      access: requestedAccess,
    };

    const token = this.auth.signToken(tokenPayload);
    const response = {
      token,
      access_token: token,
      expires_in: 3600,
      issued_at: new Date().toISOString(),
    };
    return response;
  }

  @Get(':id/v2/*name/tags/list')
  async tags(
    @Param('id') id: string,
    @Param('name') name: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return res.status(404).json({ ok: false, error: 'not found' });

    if (r.config?.authEnabled !== false) {
      const t = await this.tokenAllows(req, name, 'pull');
      if (!t.allowed) {
        const ah = req?.headers?.authorization || req?.headers?.Authorization;
        if (!ah) {
          res.setHeader('WWW-Authenticate', this.buildAuthChallenge(req, id, name, 'pull'));
          return res.status(401).json({ ok: false, message: 'authentication required' });
        }
        return res.status(403).json({ ok: false, message: t.reason });
      }
    }

    const result = await this.pluginManager.listVersions(r, name);
    if (!result?.ok) return res.status(200).json({ name, tags: [] });
    return res.status(200).json({ name, tags: result.versions });
  }

  @Get(':id/v2/*name/manifests/:tag')
  async manifest(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('tag') tag: string,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) {
      return res.status(404).json({ ok: false, message: 'not found' });
    }

    if (r.config?.authEnabled !== false) {
      const t = await this.tokenAllows(req, name, 'pull');
      if (!t.allowed) {
        const ah = req?.headers?.authorization || req?.headers?.Authorization;
        if (!ah) {
          res.setHeader('WWW-Authenticate', this.buildAuthChallenge(req, id, name, 'pull'));
          return res.status(401).json({ ok: false, message: 'authentication required' });
        }
        return res.status(403).json({ ok: false, message: t.reason });
      }
    }

    // For group repositories delegate to pluginManager download which
    // will iterate members. Only call plugin.getBlob directly for non-group
    // repos where the plugin owns blob storage.
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    if (r.type === 'group') {
      const userId = this.getUserIdFromRequest(req);
      const result = await this.pluginManager.download(
        r,
        name,
        tag,
        new Set(),
        userId,
      );
      if (req && req.headers?.authorization) {
        const t = await this.tokenAllows(req, name, 'pull');
        if (!t.allowed)
          return res
            ? res.status(403).json({ ok: false, message: t.reason })
            : { ok: false, message: t.reason };
      }
      if (!result?.ok) return res.status(404).json(result);
      if (result.url) {
        if (result.url.startsWith('file://')) {
          const fp = result.url.replace(/^file:\/\//, '');
          try {
            const buffer = await fs.promises.readFile(fp);
            try {
              const json = JSON.parse(buffer.toString('utf8'));
              res.setHeader('Content-Type', 'application/json');
              return res.status(200).json(json);
            } catch (e) {
              res.setHeader('Content-Type', 'application/octet-stream');
              return res.status(200).send(buffer);
            }
          } catch (err: any) {
            return res.status(500).json({
              ok: false,
              message:
                'failed reading storage file' +
                (err?.message ? `: ${err.message}` : ''),
            });
          }
        }
        return res.redirect(result.url);
      }
      if (result.data || result.body) {
        const body = result.data || result.body;
        try {
          const json = JSON.parse(body.toString());
          // Set Docker manifest content type
          res.setHeader('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
          return res.status(200).json(json);
        } catch (e) {
          return res.status(200).send(body);
        }
      }
      return res.status(200).json(result);
    }
    if (plugin && typeof plugin.getBlob === 'function') {
      // plugin can serve manifests/blobs directly
      const out = await plugin.getBlob(r, name, tag);
      // if a token is present we must verify the scope permits 'pull'
      if (req && req.headers?.authorization) {
        const t = await this.tokenAllows(req, name, 'pull');
        if (!t.allowed)
          return res
            ? res.status(403).json({ ok: false, message: t.reason })
            : { ok: false, message: t.reason };
      }
      if (!out?.ok) {
        return res ? res.status(404).json(out) : out;
      }

      // when plugin returns a url, redirect
      if (out.url) {
        // when plugin returns a URL we prefer to stream local storage directly
        try {
          if (res && out.url.startsWith('file://')) {
            // If plugin returned a local file:// path, read it directly from disk
            const fp = out.url.replace(/^file:\/\//, '');
            try {
              const buffer = await fs.promises.readFile(fp);
              // try to parse JSON manifest; if it fails fallback to octet-stream
              try {
                const json = JSON.parse(buffer.toString('utf8'));
                res.setHeader('Content-Type', 'application/json');
                return res.status(200).json(json);
              } catch (e) {
                res.setHeader('Content-Type', 'application/octet-stream');
                return res.status(200).send(buffer);
              }
            } catch (err: any) {
              return res.status(500).json({
                ok: false,
                message:
                  'failed reading storage file' +
                  (err?.message ? `: ${err.message}` : ''),
              });
            }
          } else if (res && out.url.startsWith('s3://')) {
            // compute a storage key or file path to pass to storage service
            let keyForStorage = out.url;
            if (out.url.startsWith('file://'))
              keyForStorage = out.url.replace(/^file:\/\//, '');
            else if (out.url.startsWith('s3://')) {
              // remove bucket prefix so storage.getStream can route based on key
              keyForStorage = out.url.replace(/^s3:\/\//, '');
            }
            // support Range requests
            const rangeHeader = req?.headers?.range as string | undefined;
            let range;
            if (rangeHeader && /^bytes=\d*-?\d*$/.test(rangeHeader)) {
              const m = rangeHeader.replace(/bytes=/, '').split('-');
              const start = m[0] ? parseInt(m[0], 10) : undefined;
              const end = m[1]
                ? m[1].length
                  ? parseInt(m[1], 10)
                  : undefined
                : undefined;
              range = { start, end };
            }
            const streamRes = (await this.storage.getStream(
              keyForStorage,
              range,
            )) as any;
            if (!streamRes) {
              return res
                .status(404)
                .json({ ok: false, message: 'Stream not available' });
            }
            const size = streamRes.size ?? undefined;
            const contentType =
              streamRes.contentType ?? 'application/octet-stream';
            res.setHeader('Accept-Ranges', 'bytes');
            if (range && typeof range.start === 'number') {
              const start = range.start as number;
              const end = (
                typeof range.end === 'number'
                  ? range.end
                  : size
                    ? size - 1
                    : undefined
              ) as number;
              const chunkLength = end - start + 1;
              if (typeof size === 'number')
                res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
              res.setHeader('Content-Length', String(chunkLength));
              res.setHeader('Content-Type', contentType);
              return res.status(206).send(streamRes.stream);
            }
            if (size) res.setHeader('Content-Length', String(size));
            res.setHeader('Content-Type', contentType);
            return res.status(200).send(streamRes.stream);
          }
        } catch (err: any) {
          return res.status(500).json({
            ok: false,
            message:
              'failed reading storage file' +
              (err?.message ? `: ${err.message}` : ''),
          });
        }
        return res ? res.redirect(out.url) : out;
      }
      if (out.data || out.body) {
        console.debug('[MANIFEST DEBUG] Returning from data/body');
        const body = out.data || out.body;
        try {
          const json = JSON.parse(body.toString());
          // Set Docker manifest content type
          res.setHeader('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
          return res.status(200).json(json);
        } catch (e) {
          console.debug('[MANIFEST DEBUG] JSON parse failed', e);
          return res.status(200).send(body);
        }
      }

      if (out.storageKey) {
        console.debug('[MANIFEST DEBUG] Using storageKey', out.storageKey);
        try {
          const streamRes = await this.storage.getStream(out.storageKey);
          if (!streamRes) return res.status(404).json({ ok: false, message: 'Stream not available' });

          const { stream, size, contentType } = streamRes;
          console.debug('[MANIFEST DEBUG] Stream info', { size, contentType });

          res.setHeader('Content-Type', contentType || 'application/vnd.docker.distribution.manifest.v2+json');
          if (size) res.setHeader('Content-Length', String(size));
          if (res) return stream.pipe(res);
          return { ok: true, stream };
        } catch (err) {
          console.error('[MANIFEST DEBUG] Storage error', err);
          return res.status(500).json({ ok: false, message: 'storage error' });
        }
      }

      console.debug('[MANIFEST DEBUG] Fallback to raw result');
      return res ? res.status(200).json(out) : out;
    }

    const userId = this.getUserIdFromRequest(req);
    const result = await this.pluginManager.download(
      r,
      name,
      tag,
      new Set(),
      userId,
    );
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'pull');
      if (!t.allowed)
        return res
          ? res.status(403).json({ ok: false, message: t.reason })
          : { ok: false, message: t.reason };
    }
    if (!result?.ok) return res ? res.status(404).json(result) : result;
    if (result.url) {
      try {
        if (res && result.url.startsWith('file://')) {
          // read file directly if it's a local file URL
          const fp = result.url.replace(/^file:\/\//, '');
          try {
            const buffer = await fs.promises.readFile(fp);
            try {
              const json = JSON.parse(buffer.toString('utf8'));
              res.setHeader('Content-Type', 'application/json');
              return res.status(200).json(json);
            } catch (e) {
              res.setHeader('Content-Type', 'application/octet-stream');
              return res.status(200).send(buffer);
            }
          } catch (err: any) {
            return res.status(500).json({
              ok: false,
              message:
                'failed reading storage file' +
                (err?.message ? `: ${err.message}` : ''),
            });
          }
        } else if (res && result.url.startsWith('s3://')) {
          let keyForStorage = result.url;
          if (result.url.startsWith('file://'))
            keyForStorage = result.url.replace(/^file:\/\//, '');
          else if (result.url.startsWith('s3://'))
            keyForStorage = result.url.replace(/^s3:\/\//, '');
          const rangeHeader = req?.headers?.range as string | undefined;
          let range;
          if (rangeHeader && /^bytes=\d*-?\d*$/.test(rangeHeader)) {
            const m = rangeHeader.replace(/bytes=/, '').split('-');
            const start = m[0] ? parseInt(m[0], 10) : undefined;
            const end = m[1]
              ? m[1].length
                ? parseInt(m[1], 10)
                : undefined
              : undefined;
            range = { start, end };
          }
          const streamRes = (await this.storage.getStream(
            keyForStorage,
            range,
          )) as any;
          if (!streamRes) {
            return res
              .status(404)
              .json({ ok: false, message: 'Stream not available' });
          }
          const size = streamRes.size ?? undefined;
          const contentType =
            streamRes.contentType ?? 'application/octet-stream';
          res.setHeader('Accept-Ranges', 'bytes');
          if (range && typeof range.start === 'number') {
            const start = range.start as number;
            const end = (
              typeof range.end === 'number'
                ? range.end
                : size
                  ? size - 1
                  : undefined
            ) as number;
            const chunkLength = end - start + 1;
            if (typeof size === 'number')
              res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
            res.setHeader('Content-Length', String(chunkLength));
            res.setHeader('Content-Type', contentType);
            return res.status(206).send(streamRes.stream);
          }
          if (size) res.setHeader('Content-Length', String(size));
          res.setHeader('Content-Type', contentType);
          return res.status(200).send(streamRes.stream);
        }
      } catch (err: any) {
        return res.status(500).json({
          ok: false,
          message:
            'failed reading storage file' +
            (err?.message ? `: ${err.message}` : ''),
        });
      }
      return res ? res.redirect(result.url) : result;
    }
    if (result.data || result.body) {
      const body = result.data || result.body;
      try {
        const json = JSON.parse(body.toString());
        res.setHeader('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
        return res.status(200).json(json);
      } catch (e) {
        return res.status(200).send(body);
      }
    }

    if (result.storageKey) {
      try {
        const streamRes = await this.storage.getStream(result.storageKey);
        if (!streamRes) return res.status(404).json({ ok: false, message: 'Stream not available' });
        // Use 'any' cast to access stream/size/contentType
        const { stream, size, contentType } = streamRes;
        res.setHeader('Content-Type', contentType || 'application/vnd.docker.distribution.manifest.v2+json');
        if (size) res.setHeader('Content-Length', String(size));
        if (res) return stream.pipe(res);
        return { ok: true, stream };
      } catch (err) {
        return res.status(500).json({ ok: false, message: 'storage error' });
      }
    }

    return res ? res.status(200).json(result) : result;
  }

  @Delete(':id/v2/*name/manifests/:digest')
  async deleteManifest(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r)
      return res
        ? res.status(404).json({ ok: false, message: 'not found' })
        : { ok: false, message: 'not found' };
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    }
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    if (plugin && typeof plugin.deleteManifest === 'function') {
      const out = await plugin.deleteManifest(r, name, digest);
      if (out?.ok) return res.status(202).json(out);
      return res.status(404).json(out);
    }
    // fallback: attempt to delete via storage key
    try {
      const { buildKey } = require('../../storage/key-utils');
      const key = buildKey('docker', r.name, name, `manifests/${digest}`);
      const exists = await this.storage.exists(key);
      if (!exists)
        return res.status(404).json({ ok: false, message: 'not found' });
      await this.storage.delete(key);
      return res.status(202).json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ ok: false, message: String(err) });
    }
  }

  @Put(':id/v2/*name/manifests/:tag')
  async putManifest(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('tag') tag: string,
    @Body() body: any,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return res.status(404).json({ ok: false, message: 'not found' });

    // only hosted repositories accept pushes/manifests
    if ((r.type || '').toString().toLowerCase() !== 'hosted')
      return res.status(405).json({
        ok: false,
        message: 'manifests can only be pushed to hosted repositories',
      });

    const plugin: any = this.pluginManager.getPluginForRepo(r);
    let uploadRes: any;
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    } else if (!this.fastAllowFromRoles(req, 'push')) {
      // Require auth for pushes (issue WWW-Authenticate challenge)
      res.setHeader(
        'WWW-Authenticate',
        this.buildAuthChallenge(req, id, name, 'push'),
      );
      return res
        .status(401)
        .json({ ok: false, message: 'authentication required' });
    }
    const tAuth = await this.tokenAllows(req, name, 'push');
    if (!tAuth.allowed)
      return res.status(403).json({ ok: false, message: tAuth.reason });

    // Extract userId from request for audit logging
    const userId = this.getUserIdFromRequest(req);

    if (plugin && typeof plugin.putManifest === 'function') {
      uploadRes = await plugin.putManifest(r, name, tag, body, userId);
    } else {
      uploadRes = await this.pluginManager.upload(
        r,
        {
          name,
          tag,
          manifest: body,
        },
        userId,
      );
    }
    if (uploadRes?.ok) {
      return res.status(201).json({ ok: true, id: uploadRes.id });
    }
    return res.status(400).json(uploadRes);
  }

  // single-step blob upload via body: { digest, data (base64) }
  @Put(':id/v2/*name/blobs/uploads')
  async uploadBlob(
    @Param('id') id: string,
    @Param('name') name: string,
    @Body() body: any,
    @Req() req: any,
    @Res() res: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return res.status(404).json({ ok: false, message: 'not found' });
    if ((r.type || '').toString().toLowerCase() !== 'hosted')
      return res.status(405).json({
        ok: false,
        message: 'manifests/blobs can only be uploaded to hosted repositories',
      });
    // expect body { digest, data } where data is base64 encoded blob
    const digest = body?.digest || body?.name || undefined;
    let blob: Buffer | undefined;
    if (body?.data) blob = Buffer.from(body.data, 'base64');

    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    }
    // require auth for append (push) unless x-user-roles grant access
    if (!req || !req.headers?.authorization) {
      if (!this.fastAllowFromRoles(req, 'push')) {
        res.setHeader(
          'WWW-Authenticate',
          this.buildAuthChallenge(req, id, name, 'push'),
        );
        return res
          .status(401)
          .json({ ok: false, message: 'authentication required' });
      }
    } else {
      const tAppend = await this.tokenAllows(req, name, 'push');
      if (!tAppend.allowed)
        return res.status(403).json({ ok: false, message: tAppend.reason });
    }

    const userId = this.getUserIdFromRequest(req);
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    let uploadRes: any;
    if (plugin && typeof plugin.finalizeUpload === 'function') {
      // let plugin handle single-step finalize
      uploadRes = await plugin.finalizeUpload(r, name, '', digest, blob);
    } else {
      uploadRes = await this.pluginManager.upload(
        r,
        {
          name,
          digest,
          blob,
        },
        userId,
      );
    }
    // mimic docker response partially
    if (uploadRes?.ok) {
      res.setHeader(
        'Location',
        `/repository/${id}/v2/${name}/blobs/${digest || uploadRes.id}`,
      );
      return res.status(201).json({ ok: true, id: uploadRes.id });
    }
    return res.status(400).json(uploadRes);
  }

  // finalize upload / replace (client may put raw data to uploads/:uuid)
  @Put(':id/v2/*name/blobs/uploads/:uuid')
  async uploadBlobComplete(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Body() body: any,
    @Req() req: any,
    @Res() res: any,
  ) {
    // this is a simplified single-step handler similar to uploadBlob
    const r = await this.repos.findOne(id);
    if (!r) return res.status(404).json({ ok: false, message: 'not found' });
    // check for existing session (multipart)
    const sess = await this.getSess(uuid);
    let blob: Buffer | undefined;
    if (sess) {
      blob = Buffer.concat(sess.buffers || []);
      // clean session
      await this.delSess(uuid);
    } else if (body?.data) {
      blob = Buffer.from(body.data, 'base64');
    }
    const digest = body?.digest || req?.query?.digest || uuid;
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    }
    // require auth for finalize (push) unless x-user-roles grant access
    if (!req || !req.headers?.authorization) {
      if (!this.fastAllowFromRoles(req, 'push')) {
        res.setHeader(
          'WWW-Authenticate',
          this.buildAuthChallenge(req, id, name, 'push'),
        );
        return res
          .status(401)
          .json({ ok: false, message: 'authentication required' });
      }
    } else {
      const tFinalize = await this.tokenAllows(req, name, 'push');
      if (!tFinalize.allowed)
        return res.status(403).json({ ok: false, message: tFinalize.reason });
    }

    const userId = this.getUserIdFromRequest(req);
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    let uploadRes: any;
    if (plugin && typeof plugin.finalizeUpload === 'function') {
      uploadRes = await plugin.finalizeUpload(r, name, uuid, digest, blob);
    } else {
      uploadRes = await this.pluginManager.upload(
        r,
        {
          name,
          digest,
          blob,
        },
        userId,
      );
    }
    if (uploadRes?.ok) {
      return res.status(201).json({ ok: true, id: uploadRes.id });
    }
    return res.status(400).json(uploadRes);
  }

  // multipart flow: initiate an upload session (delegates to plugin if available)
  @Post(':id/v2/*name/blobs/uploads')
  async initiateUpload(
    @Param('id') id: string,
    @Param('name') name: string,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r || (r.type || '').toString().toLowerCase() !== 'hosted') {
      return res
        ? res.status(405).json({
          ok: false,
          message: 'uploads allowed only on hosted repositories',
        })
        : { ok: false, message: 'uploads allowed only on hosted repositories' };
    }
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    }
    // require auth for single-step upload (push) unless x-user-roles grant access
    if (!req || !req.headers?.authorization) {
      if (!this.fastAllowFromRoles(req, 'push')) {
        res.setHeader(
          'WWW-Authenticate',
          this.buildAuthChallenge(req, id, name, 'push'),
        );
        return res
          .status(401)
          .json({ ok: false, message: 'authentication required' });
      }
    } else {
      const tSingle = await this.tokenAllows(req, name, 'push');
      if (!tSingle.allowed)
        return res.status(403).json({ ok: false, message: tSingle.reason });
    }
    if (plugin && typeof plugin.initiateUpload === 'function') {
      const out = await plugin.initiateUpload(r, name);
      if (out?.ok) {
        if (out.location) res.setHeader('Location', out.location);
        return res.status(202).json(out);
      }
      return res.status(400).json(out);
    }

    const uuid = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.setSess(uuid, { buffers: [], size: 0, repoId: id, name });
    res.setHeader(
      'Location',
      `/repository/${id}/v2/${name}/blobs/uploads/${uuid}`,
    );
    return res.status(202).json({ ok: true, uuid });
  }

  // append chunk to session (client may call multiple times) — delegate to plugin when supported
  @Post(':id/v2/*name/blobs/uploads/:uuid')
  async appendUpload(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('uuid') uuid: string,
    @Body() body: any,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r || (r.type || '').toString().toLowerCase() !== 'hosted') {
      return res.status(405).json({
        ok: false,
        message: 'uploads allowed only on hosted repositories',
      });
    }
    // for append we require push scope when auth token present
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'push');
      if (!t.allowed)
        return res.status(403).json({ ok: false, message: t.reason });
    }
    // require auth for manifest pushes unless x-user-roles grant access
    if (!req || !req.headers?.authorization) {
      if (!this.fastAllowFromRoles(req, 'push')) {
        res.setHeader(
          'WWW-Authenticate',
          this.buildAuthChallenge(req, id, name, 'push'),
        );
        return res
          .status(401)
          .json({ ok: false, message: 'authentication required' });
      }
    } else {
      const tManifest = await this.tokenAllows(req, name, 'push');
      if (!tManifest.allowed)
        return res.status(403).json({ ok: false, message: tManifest.reason });
    }
    const plugin: any = this.pluginManager.getPluginForRepo(r);
    if (plugin && typeof plugin.appendUpload === 'function') {
      if (!body?.data)
        return res
          .status(400)
          .json({ ok: false, message: 'missing data (base64)' });
      const chunk = Buffer.from(body.data, 'base64');
      const out = await plugin.appendUpload(r, name, uuid, chunk);
      if (out?.ok) {
        res.setHeader(
          'Location',
          `/repository/${id}/v2/${name}/blobs/uploads/${uuid}`,
        );
        return res.status(202).json(out);
      }
      return res.status(400).json(out);
    }

    const sess = await this.getSess(uuid);
    if (!sess)
      return res.status(404).json({ ok: false, message: 'session not found' });
    if (sess.repoId !== id || sess.name !== name)
      return res.status(400).json({ ok: false, message: 'mismatch' });
    if (!body?.data)
      return res
        .status(400)
        .json({ ok: false, message: 'missing data (base64)' });
    const chunk = Buffer.from(body.data, 'base64');
    sess.buffers.push(chunk);
    sess.size += chunk.length;
    await this.setSess(uuid, sess);
    // mimick docker: return 202 with location
    res.setHeader(
      'Location',
      `/repository/${id}/v2/${name}/blobs/uploads/${uuid}`,
    );
    res.setHeader('Range', `0-${sess.size - 1}`);
    return res.status(202).json({ ok: true, uploaded: sess.size });
  }

  // get blob by digest (delegates to plugin.getBlob if available)
  @Get(':id/v2/*name/blobs/:digest')
  async getBlob(
    @Param('id') id: string,
    @Param('name') name: string,
    @Param('digest') digest: string,
    @Res() res: any,
    @Req() req?: any,
  ) {
    const r = await this.repos.findOne(id);
    if (!r) return res.status(404).json({ ok: false, message: 'not found' });

    if (r.config?.authEnabled !== false) {
      const t = await this.tokenAllows(req, name, 'pull');
      if (!t.allowed) {
        const ah = req?.headers?.authorization || req?.headers?.Authorization;
        if (!ah) {
          res.setHeader('WWW-Authenticate', this.buildAuthChallenge(req, id, name, 'pull'));
          return res.status(401).json({ ok: false, message: 'authentication required' });
        }
        return res.status(403).json({ ok: false, message: t.reason });
      }
    }

    const plugin: any = this.pluginManager.getPluginForRepo(r);
    // Allow download for hosted, proxy and group repos
    const repoType = (r.type || '').toString().toLowerCase();
    if (repoType !== 'hosted' && repoType !== 'proxy' && repoType !== 'group') {
      return res.status(405).json({
        ok: false,
        message: 'blob downloads not supported for this repo type',
      });
    }

    const userId = this.getUserIdFromRequest(req);
    const result = await this.pluginManager.download(
      r,
      name,
      digest,
      new Set(),
      userId,
    );
    if (req && req.headers?.authorization) {
      const t = await this.tokenAllows(req, name, 'pull');
      if (!t.allowed)
        return res
          ? res.status(403).json({ ok: false, message: t.reason })
          : { ok: false, message: t.reason };
    }
    if (!result?.ok) return res ? res.status(404).json(result) : result;

    // Stream blob from storage if storageKey is available (avoids OOM for large layers)
    if (result.storageKey) {
      try {
        const streamRes = (await this.storage.getStream(
          result.storageKey,
        )) as any;
        if (!streamRes) throw new Error('Stream not available');
        const { stream, size } = streamRes;
        if (res) {
          res.setHeader('Content-Type', 'application/octet-stream');
          if (size) res.setHeader('Content-Length', size.toString());
          // Docker Registry V2 requires the digest header
          if (digest) res.setHeader('Docker-Content-Digest', digest);
          return stream.pipe(res);
        }
        return { ok: true, stream };
      } catch (err) {
        console.warn(
          `[DOCKER] streaming failed for ${result.storageKey}, falling back`,
          err,
        );
      }
    }

    if (result.url) {
      if (result.url.startsWith('file://')) {
        const fp = result.url.replace(/^file:\/\//, '');
        try {
          if (res) {
            const stat = fs.statSync(fp);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', stat.size.toString());
            if (digest) res.setHeader('Docker-Content-Digest', digest);
            return fs.createReadStream(fp).pipe(res);
          }
          const buffer = await fs.promises.readFile(fp);
          return { ok: true, url: result.url, buffer };
        } catch (err: any) {
          return res.status(500).json({
            ok: false,
            message:
              'failed reading storage file' +
              (err?.message ? `: ${err.message}` : ''),
          });
        }
      }
      return res ? res.redirect(result.url) : result;
    }
    if (result.data || result.body) {
      const body = result.data || result.body;
      try {
        const json = JSON.parse(body.toString());
        res.setHeader('Content-Type', 'application/vnd.docker.distribution.manifest.v2+json');
        return res.status(200).json(json);
      } catch (e) {
        return res.status(200).send(body);
      }
    }

    if (result.storageKey) {
      try {
        const streamRes = await this.storage.getStream(result.storageKey);
        if (!streamRes) return res.status(404).json({ ok: false, message: 'Stream not available' });
        // Use 'any' cast to access stream/size/contentType
        const { stream, size, contentType } = streamRes;
        res.setHeader('Content-Type', contentType || 'application/vnd.docker.distribution.manifest.v2+json');
        if (size) res.setHeader('Content-Length', String(size));
        if (res) return stream.pipe(res);
        return { ok: true, stream };
      } catch (err) {
        return res.status(500).json({ ok: false, message: 'storage error' });
      }
    }

    return res ? res.status(200).json(result) : result;
  }
}
