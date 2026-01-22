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

import { initStorage } from 'src/modules/plugins/impl/maven-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/maven-plugin/utils/key-utils';
import * as mavenUtils from 'src/modules/plugins/impl/maven-plugin/utils/maven';

jest.mock('src/modules/plugins/impl/maven-plugin/utils/key-utils');
jest.mock('src/modules/plugins/impl/maven-plugin/utils/maven');
jest.mock('crypto', () => ({
  createHash: jest.fn().mockReturnValue({
    update: jest.fn().mockReturnThis(),
    digest: jest.fn().mockReturnValue('hash'),
  }),
}));

jest.mock('src/modules/plugins/impl/maven-plugin/proxy/fetch', () => ({
  initProxy: jest.fn().mockImplementation(() => ({
    proxyFetch: jest.fn().mockResolvedValue({
      ok: true,
      body: Buffer.from('proxied'),
      headers: { 'content-type': 'application/java-archive' },
    }),
  })),
}));

describe('MavenPlugin Storage', () => {
  let context: any;
  let storageMethods: any;
  const repo: any = { id: 'r1', name: 'maven-repo', type: 'hosted' };

  beforeEach(() => {
    context = {
      storage: {
        save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
        get: jest.fn(),
        exists: jest.fn(),
        saveStream: jest.fn(),
      },
      indexArtifact: jest.fn(),
      getRepo: jest.fn(),
    };
    storageMethods = initStorage(context);

    (keyUtils.buildKey as jest.Mock).mockImplementation((...args) =>
      args.join('/'),
    );
    (mavenUtils.normalizeRepoPath as jest.Mock).mockImplementation((p) => p);
    (mavenUtils.parseMavenCoordsFromPath as jest.Mock).mockImplementation(
      (path) => {
        if (path.includes('lib'))
          return { packageName: 'com.example/lib', version: '1.0.0' };
        return null;
      },
    );

    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => { });
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('upload', () => {
    it('should save and index artifact', async () => {
      const pkg = {
        path: 'com/example/lib/1.0.0/lib-1.0.0.jar',
        content: Buffer.from('content'),
      };

      const result = await storageMethods.upload(repo, pkg);

      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalled();
      expect(context.indexArtifact).toHaveBeenCalledWith(
        repo,
        expect.objectContaining({
          metadata: expect.objectContaining({
            name: 'com.example/lib',
            version: '1.0.0',
          }),
        }),
      );
    });

    it('should NOT index metadata/checksum files', async () => {
      const pkg = {
        path: 'com/example/lib/maven-metadata.xml',
        content: Buffer.from('xml'),
      };

      const result = await storageMethods.upload(repo, pkg);

      expect(result.ok).toBe(true);
      expect(context.indexArtifact).not.toHaveBeenCalled();
    });

    it('should prevent redeployment if disabled', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      const pkg = {
        path: 'com/example/lib/1.0.0/lib-1.0.0.jar',
        content: Buffer.from('c'),
      };

      context.storage.exists.mockResolvedValue(true);

      const result = await storageMethods.upload(repoNoRedeploy, pkg);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('Redeployment');
    });

    it('should allow snapshot redeployment even if disabled', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      const pkg = {
        path: 'com/example/lib/1.0.0-SNAPSHOT/lib-1.0.0-SNAPSHOT.jar',
        version: '1.0.0-SNAPSHOT',
        content: Buffer.from('c'),
      };

      // Should verify version is snapshot logic
      (mavenUtils.parseMavenCoordsFromPath as jest.Mock).mockReturnValue({
        packageName: 'com.example/lib',
        version: '1.0.0-SNAPSHOT',
      });

      const result = await storageMethods.upload(repoNoRedeploy, pkg);

      expect(result.ok).toBe(true);
    });
  });

  describe('handlePut', () => {
    it('should handle buffer body and index', async () => {
      const req = { body: Buffer.from('content') };
      const path = 'com/example/lib/1.0.0/lib-1.0.0.jar';

      const result = await storageMethods.handlePut(repo, path, req);

      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalled();
      expect(context.indexArtifact).toHaveBeenCalled();
    });

    it('should handle stream', async () => {
      const req = {
        on: jest.fn(),
        pipe: jest.fn(),
      };
      // Mock storage.saveStream for stream path
      context.storage.saveStream.mockResolvedValue({
        size: 100,
        contentHash: 'h',
      });

      const path = 'com/example/lib/1.0.0/lib-1.0.0.jar';
      const result = await storageMethods.handlePut(repo, path, req);

      expect(result.ok).toBe(true);
      expect(context.indexArtifact).toHaveBeenCalled();
    });

    it('should throw on redeployment not allowed', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      const path = 'com/example/lib/1.0.0/lib-1.0.0.jar';
      context.storage.exists.mockResolvedValue(true);

      await expect(
        storageMethods.handlePut(repoNoRedeploy, path, {
          body: Buffer.from('c'),
        }),
      ).rejects.toThrow('Redeployment');
    });

    describe('group write policies', () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1', 'm2'] },
      };
      const m1 = { id: 'm1', type: 'hosted' };
      const m2 = { id: 'm2', type: 'hosted' };

      it('should handle mirror policy', async () => {
        const mirrorRepo = {
          ...groupRepo,
          config: { ...groupRepo.config, writePolicy: 'mirror' },
        };
        context.getRepo.mockResolvedValue(m1);
        const result = await storageMethods.handlePut(mirrorRepo, 'path', {
          body: Buffer.from('c'),
        });
        expect(result.ok).toBe(true);
      });

      it('should handle preferredWriter policy', async () => {
        const prefRepo = {
          ...groupRepo,
          config: {
            ...groupRepo.config,
            writePolicy: 'preferred',
            preferredWriter: 'm2',
          },
        };
        context.getRepo.mockImplementation((id) =>
          Promise.resolve(id === 'm2' ? m2 : null),
        );
        const result = await storageMethods.handlePut(prefRepo, 'path', {
          body: Buffer.from('c'),
        });
        expect(result.ok).toBe(true);
      });

      it('should reject when writePolicy is none', async () => {
        const readOnlyRepo = { ...groupRepo, config: { writePolicy: 'none' } };
        const result = await storageMethods.handlePut(readOnlyRepo, 'path', {
          body: Buffer.from('c'),
        });
        expect(result.ok).toBe(false);
        expect(result.message).toContain('read-only');
      });
    });
  });

  describe('download', () => {
    it('should download normal artifact', async () => {
      context.storage.get.mockResolvedValue(Buffer.from('content'));
      const result = await storageMethods.download(
        repo,
        'com/example/lib/1.0.0/lib-1.0.0.jar',
      );
      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should compute checksum on the fly if missing', async () => {
      // Mock get base artifact success, but checksum file invalid/missing
      context.storage.get.mockImplementation((key: string) => {
        if (key.endsWith('.jar')) return Promise.resolve(Buffer.from('base-content'));
        return Promise.resolve(null);
      });

      const result = await storageMethods.download(
        repo,
        'com/example/lib/1.0.0/lib-1.0.0.jar.sha1',
      );

      expect(result.ok).toBe(true);
      expect(result.contentType).toBe('text/plain');
      // Mock crypto returns 'hash\n'
      expect(result.data.toString()).toContain('hash');
    });

    it('should handle proxy download and caching', async () => {
      const proxyRepo = {
        id: 'p1',
        type: 'proxy',
        config: { cacheMaxAgeDays: 7 },
      };
      const result = await storageMethods.download(
        proxyRepo as any,
        'com/example/lib/1.0.0/lib-1.0.0.jar',
      );
      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalled();
    });
  });

  describe('getContentBuffer', () => {
    // We can expose internal functions for testing if needed, or test via upload
    it('should decode base64 encoding in pkg', async () => {
      const pkg = {
        path: 'p',
        content: Buffer.from('hello').toString('base64'),
        encoding: 'base64',
      };
      const result = await storageMethods.upload(repo, pkg);
      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('hello'),
      );
    });

    it('should handle buffer wrapper from JSON', async () => {
      const pkg = {
        path: 'p',
        buffer: { type: 'Buffer', data: [72, 105] }, // "Hi"
      };
      const result = await storageMethods.upload(repo, pkg);
      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('Hi'),
      );
    });
  });
});
