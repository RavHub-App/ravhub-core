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

import { PluginDelegatorService } from 'src/modules/plugins/plugin-delegator.service';
import { PluginsService } from 'src/modules/plugins/plugins.service';
import { LicenseService } from 'src/modules/license/license.service';
import { RedlockService } from 'src/modules/redis/redlock.service';
import { ArtifactIndexService } from 'src/modules/plugins/artifact-index.service';

describe('PluginDelegatorService (Unit)', () => {
  let service: PluginDelegatorService;
  let pluginsService: jest.Mocked<PluginsService>;
  let licenseService: jest.Mocked<LicenseService>;
  let redlockService: jest.Mocked<RedlockService>;
  let artifactIndexService: jest.Mocked<ArtifactIndexService>;

  beforeEach(() => {
    pluginsService = {
      list: jest.fn().mockReturnValue([]),
      getInstance: jest.fn(),
    } as any;

    licenseService = {
      isFeatureEnabled: jest.fn().mockReturnValue(true),
    } as any;

    redlockService = {
      runWithLock: jest.fn((key, ttl, fn) => fn()),
    } as any;

    artifactIndexService = {
      indexArtifact: jest.fn().mockResolvedValue(undefined),
    } as any;

    service = new PluginDelegatorService(
      pluginsService,
      licenseService,
      redlockService,
      artifactIndexService,
    );
  });

  describe('getPluginForRepo', () => {
    it('should return plugin instance', () => {
      const mockPlugin = { name: 'npm-plugin' };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = service.getPluginForRepo(repo as any);

      expect(result).toBe(mockPlugin);
      expect(pluginsService.getInstance).toHaveBeenCalledWith('npm');
    });

    it('should return null if plugin not found', () => {
      const repo = { manager: 'unknown', name: 'test-repo' };
      pluginsService.list.mockReturnValue([]);

      const result = service.getPluginForRepo(repo as any);

      expect(result).toBeNull();
    });

    it('should throw if feature not enabled by license', () => {
      const repo = { manager: 'enterprise', name: 'test-repo' };
      licenseService.isFeatureEnabled.mockReturnValue(false);

      expect(() => service.getPluginForRepo(repo as any)).toThrow(
        'not enabled by your current license',
      );
    });
  });

  describe('handlePut', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        handlePut: jest.fn().mockResolvedValue({ ok: true, metadata: {} }),
      };
      const repo = {
        manager: 'npm',
        name: 'test-repo',
        type: 'hosted',
        id: 'repo1',
      };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.handlePut(
        repo as any,
        'path',
        {} as any,
        'user1',
      );

      expect(result.ok).toBe(true);
      expect(mockPlugin.handlePut).toHaveBeenCalled();
    });

    it('should throw if repository type not hosted or group', async () => {
      const repo = { manager: 'npm', type: 'proxy' };

      await expect(
        service.handlePut(repo as any, 'path', {} as any),
      ).rejects.toThrow('PUT only supported for hosted and group');
    });

    it('should throw if manager not configured', async () => {
      const repo = { type: 'hosted' };

      await expect(
        service.handlePut(repo as any, 'path', {} as any),
      ).rejects.toThrow('manager not configured');
    });

    it('should throw if plugin does not support PUT', async () => {
      const mockPlugin = {}; // No handlePut
      const repo = { manager: 'npm', name: 'test-repo', type: 'hosted' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);
      await expect(
        service.handlePut(repo as any, 'path', {} as any),
      ).rejects.toThrow('Plugin does not support PUT');
    });

    it('should handle indexing error in handlePut', async () => {
      artifactIndexService.indexArtifact.mockRejectedValue(
        new Error('index-fail'),
      );
      const mockPlugin = {
        handlePut: jest.fn().mockResolvedValue({ ok: true, metadata: {} }),
      };
      const repo = {
        manager: 'npm',
        name: 'test-repo',
        type: 'hosted',
        id: 'repo1',
      };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.handlePut(
        repo as any,
        'path',
        {} as any,
        'user1',
      );
      expect(result.ok).toBe(true);
      expect(artifactIndexService.indexArtifact).toHaveBeenCalled();
    });
  });

  describe('upload', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        upload: jest.fn().mockResolvedValue({ ok: true }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.upload(repo as any, {}, 'user1');

      expect(result.ok).toBe(true);
      expect(mockPlugin.upload).toHaveBeenCalled();
    });

    it('should return error if plugin not found', async () => {
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([]);

      const result = await service.upload(repo as any, {});

      expect(result.ok).toBe(false);
      expect(result.message).toContain('No plugin found');
    });

    it('should return error if plugin does not support upload', async () => {
      const mockPlugin = {};
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);
      const result = await service.upload(repo as any, {});
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Plugin does not support upload');
    });

    it('should handle indexing error in upload', async () => {
      artifactIndexService.indexArtifact.mockRejectedValue(
        new Error('index-fail'),
      );
      const mockPlugin = {
        upload: jest.fn().mockResolvedValue({ ok: true, metadata: {} }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.upload(repo as any, {}, 'user1');
      expect(result.ok).toBe(true);
    });
  });

  describe('download', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        download: jest.fn().mockResolvedValue({ ok: true }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.download(repo as any, 'package', '1.0');

      expect(result.ok).toBe(true);
      expect(mockPlugin.download).toHaveBeenCalledWith(repo, 'package', '1.0');
    });

    it('should return error if plugin not found', async () => {
      const repo = { manager: 'npm' };
      pluginsService.list.mockReturnValue([]);
      const result = await service.download(repo as any, 'pkg');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('No plugin found');
    });

    it('should return error if plugin does not support download', async () => {
      const mockPlugin = {};
      const repo = { manager: 'npm' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);
      const result = await service.download(repo as any, 'pkg');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Plugin does not support download');
    });
  });

  describe('listVersions', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        listVersions: jest
          .fn()
          .mockResolvedValue({ ok: true, versions: ['1.0', '2.0'] }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.listVersions(repo as any, 'package');

      expect(result.ok).toBe(true);
      expect((result as any).versions).toHaveLength(2);
    });

    it('should return error if plugin does not support listVersions', async () => {
      const mockPlugin = {};
      const repo = { manager: 'npm' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);
      const result = await service.listVersions(repo as any, 'pkg');
      expect(result.ok).toBe(false);
      expect((result as any).message).toContain(
        'Plugin does not support listVersions',
      );
    });
  });

  describe('authenticate', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        authenticate: jest.fn().mockResolvedValue({ ok: true }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.authenticate(repo as any, {
        username: 'test',
      });

      expect(result.ok).toBe(true);
      expect(mockPlugin.authenticate).toHaveBeenCalled();
    });
  });

  describe('proxyFetch', () => {
    it('should delegate to plugin', async () => {
      const mockPlugin = {
        proxyFetch: jest.fn().mockResolvedValue({ ok: true }),
      };
      const repo = { manager: 'npm', name: 'test-repo' };
      pluginsService.list.mockReturnValue([{ key: 'npm' }] as any);
      pluginsService.getInstance.mockReturnValue(mockPlugin as any);

      const result = await service.proxyFetch(repo as any, 'http://upstream');

      expect(result.ok).toBe(true);
      expect(mockPlugin.proxyFetch).toHaveBeenCalled();
    });
  });
});
