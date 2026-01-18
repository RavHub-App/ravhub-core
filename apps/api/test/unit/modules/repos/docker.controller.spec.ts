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

import { Test, TestingModule } from '@nestjs/testing';
import { DockerCompatController } from 'src/modules/repos/docker.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { ReposService } from 'src/modules/repos/repos.service';
import { PluginManagerService } from 'src/modules/plugins/plugin-manager.service';
import { RedisService } from 'src/modules/redis/redis.service';

describe('DockerCompatController (unit)', () => {
  let controller: DockerCompatController;

  const repo = {
    id: 'r1',
    name: 'r1',
    manager: 'docker',
    type: 'hosted',
    config: { authEnabled: false },
  };

  const reposService = {
    findOne: jest.fn(async (id: string) => (id === repo.id ? repo : null)),
  };

  const mockRedisService = {
    isEnabled: jest.fn(() => false),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  describe('when plugin implements flows', () => {
    const pluginMock: any = {
      initiateUpload: jest.fn(async () => ({
        ok: true,
        uuid: 'u1',
        location: '/upload/u1',
      })),
      appendUpload: jest.fn(async () => ({ ok: true, uploaded: 4 })),
      finalizeUpload: jest.fn(async () => ({
        ok: true,
        id: 'library/test:sha',
      })),
      getBlob: jest.fn(async () => ({ ok: true, url: 'mem://blob' })),
      putManifest: jest.fn(async () => ({ ok: true, id: 'lib:m' })),
    };

    const pluginManager = {
      getPluginForRepo: jest.fn(() => pluginMock),
      upload: jest.fn(),
      // download should delegate to the plugin mock when plugin exists
      download: jest.fn(async (r: any, n: string, d: string) =>
        pluginMock.getBlob(r, n, d),
      ),
      listVersions: jest.fn(async () => ({ ok: true, versions: ['v1'] })),
    };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [DockerCompatController],
        providers: [
          { provide: ReposService, useValue: reposService },
          { provide: PluginManagerService, useValue: pluginManager },
          {
            provide: AuthService,
            useValue: {
              verifyToken: jest.fn(() => null),
              validateUser: jest.fn(async () => false),
              signToken: jest.fn(() => 'signed-token'),
            },
          },
          { provide: StorageService, useValue: { getStream: jest.fn() } },
          { provide: RedisService, useValue: mockRedisService },
        ],
      }).compile();

      controller = module.get<DockerCompatController>(DockerCompatController);
    });

    it('delegates initiateUpload to plugin', async () => {
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.initiateUpload(repo.id, 'library/test', res, {
        headers: { 'x-user-roles': 'admin' },
      });
      expect(pluginManager.getPluginForRepo).toHaveBeenCalled();
      expect(pluginMock.initiateUpload).toHaveBeenCalledWith(
        repo,
        'library/test',
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('initiateUpload should challenge when no auth present', async () => {
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.initiateUpload(
        repo.id,
        'library/test',
        res,
        undefined as any,
      );
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.setHeader).toHaveBeenCalledWith(
        'WWW-Authenticate',
        expect.stringContaining('/repository/r1/v2/token'),
      );
    });

    it('initiateUpload should accept valid Bearer token', async () => {
      // make AuthService verifyToken return a payload authorizing push
      const payload = {
        access: [
          { type: 'repository', name: 'library/test', actions: ['push'] },
        ],
      } as any;
      (controller as any).auth.verifyToken = jest.fn(() => payload);

      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.initiateUpload(repo.id, 'library/test', res, {
        headers: { authorization: 'Bearer fake' },
      } as any);
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('delegates appendUpload to plugin', async () => {
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.appendUpload(
        repo.id,
        'library/test',
        'u1',
        { data: Buffer.from('data').toString('base64') },
        res,
        { headers: { 'x-user-roles': 'admin' } },
      );
      expect(pluginMock.appendUpload).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('delegates finalizeUpload to plugin', async () => {
      const res: any = { status: jest.fn(() => res), json: jest.fn() };
      await controller.uploadBlobComplete(
        repo.id,
        'library/test',
        'u1',
        { data: Buffer.from('blob').toString('base64') },
        { headers: { 'x-user-roles': 'admin' } },
        res,
      );
      expect(pluginMock.finalizeUpload).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('delegates putManifest to plugin', async () => {
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.putManifest(
        repo.id,
        'library/test',
        'v1',
        { foo: 'bar' },
        res,
        { headers: { 'x-user-roles': 'admin' } },
      );
      expect(pluginMock.putManifest).toHaveBeenCalledWith(
        repo,
        'library/test',
        'v1',
        { foo: 'bar' },
        undefined,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('delegates getBlob to plugin', async () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
        end: jest.fn(),
        redirect: jest.fn(),
      };
      await controller.getBlob(
        repo.id,
        'library/test',
        'sha',
        res as any,
        {} as any,
      );
      expect(pluginMock.getBlob).toHaveBeenCalledWith(
        repo,
        'library/test',
        'sha',
      );
      expect(res.redirect).toHaveBeenCalledWith('mem://blob');
    });

    it('mints docker token for valid Basic auth', async () => {
      (controller as any).auth.validateUser = jest.fn(async () => true);
      (controller as any).auth.signToken = jest.fn(() => 'tok123');

      const basic = Buffer.from('u:p').toString('base64');
      const out: any = await (controller as any).token(
        repo.id,
        {},
        {
          query: { scope: 'repository:library/alpine:pull' },
          headers: { authorization: `Basic ${basic}` },
        },
      );

      expect(out.token).toBe('tok123');
      expect(out.access_token).toBe('tok123');
    });
  });

  describe('when no plugin present (fallback)', () => {
    const pluginManager = {
      getPluginForRepo: jest.fn(() => null),
      upload: jest.fn(async () => ({ ok: true, id: 'fallback:1' })),
      download: jest.fn(async () => ({ ok: true, url: 'mem://m' })),
      listVersions: jest.fn(async () => ({ ok: true, versions: ['latest'] })),
    };

    beforeEach(async () => {
      const module: TestingModule = await Test.createTestingModule({
        controllers: [DockerCompatController],
        providers: [
          { provide: ReposService, useValue: reposService },
          { provide: PluginManagerService, useValue: pluginManager },
          {
            provide: AuthService,
            useValue: {
              verifyToken: jest.fn(() => null),
              validateUser: jest.fn(async () => false),
              signToken: jest.fn(() => 'signed-token'),
            },
          },
          { provide: StorageService, useValue: { getStream: jest.fn() } },
          { provide: RedisService, useValue: mockRedisService },
        ],
      }).compile();

      controller = module.get<DockerCompatController>(DockerCompatController);
    });

    it('fallbacks to upload manager for single-step upload', async () => {
      const res: any = {
        setHeader: jest.fn(),
        status: jest.fn(() => res),
        json: jest.fn(),
      };
      await controller.uploadBlob(
        repo.id,
        'name',
        { digest: 'd1', data: Buffer.from('x').toString('base64') },
        { headers: { 'x-user-roles': 'admin' } },
        res,
      );
      expect(pluginManager.upload).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('fallback download returns from download', async () => {
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        setHeader: jest.fn(),
        end: jest.fn(),
        redirect: jest.fn(),
      };
      await controller.getBlob(repo.id, 'name', 'd1', res as any, {} as any);
      expect(pluginManager.download).toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalled();
    });
  });
});
