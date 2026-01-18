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

import { PluginsService } from 'src/modules/plugins/plugins.service';
import AppDataSource from 'src/data-source';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
  },
}));

describe('PluginsService - indexArtifact (Unit)', () => {
  let service: PluginsService;
  let mockStorage: any;
  let mockMonitor: any;
  let mockAudit: any;
  let mockRedis: any;
  let mockRedlock: any;
  let mockArtifactRepo: any;

  beforeEach(() => {
    mockStorage = {};
    mockMonitor = { increment: jest.fn() };
    mockAudit = { logSuccess: jest.fn().mockResolvedValue({}) };
    mockRedis = {};
    mockRedlock = {};

    mockArtifactRepo = {
      findOne: jest.fn(),
      save: jest
        .fn()
        .mockImplementation((a) => Promise.resolve({ id: 'a1', ...a })),
      create: jest.fn().mockImplementation((a) => a),
    };

    (AppDataSource.getRepository as jest.Mock).mockReturnValue(
      mockArtifactRepo,
    );

    service = new PluginsService(
      mockStorage,
      mockAudit,
      mockRedis,
      mockRedlock,
    );
  });

  it('should index an artifact with name:version ID', async () => {
    const repo = { id: 'r1', name: 'repo1', manager: 'npm' };
    const result = { id: 'mypkg:1.0.0', metadata: { size: 123 } };

    // We need to access the private context to get indexArtifact
    const context = (service as any).getPluginContext();
    await context.indexArtifact(repo, result);

    expect(mockArtifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'mypkg',
        version: '1.0.0',
        size: 123,
      }),
    );
    expect(mockArtifactRepo.save).toHaveBeenCalled();
  });

  it('should index an artifact with @ versioning', async () => {
    const repo = { id: 'r1', name: 'repo1', manager: 'pypi' };
    const result = { id: 'pypkg@2.0', metadata: {} };

    const context = (service as any).getPluginContext();
    await context.indexArtifact(repo, result);

    expect(mockArtifactRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        packageName: 'pypkg',
        version: '2.0',
      }),
    );
  });

  it('should update existing artifact', async () => {
    const repo = { id: 'r1', name: 'repo1' };
    const result = { id: 'pkg:1', metadata: { size: 500 } };

    mockArtifactRepo.findOne.mockResolvedValue({
      id: 'existing',
      size: 100,
    } as any);

    const context = (service as any).getPluginContext();
    await context.indexArtifact(repo, result);

    expect(mockArtifactRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'existing',
        size: 500,
      }),
    );
  });

  it('should reload plugins', async () => {
    const spy = jest
      .spyOn(service as any, 'loadBuiltInFeatures')
      .mockResolvedValue(undefined);
    const res = await service.reloadPlugins();
    expect(res.ok).toBeTruthy();
    expect(spy).toHaveBeenCalled();
  });

  it('should ping a plugin and return capabilities', async () => {
    const mockPlugin = {
      metadata: { key: 'npm', configSchema: { foo: 'bar' } },
      ping: jest.fn().mockResolvedValue({ ok: true }),
      upload: jest.fn(),
      proxyFetch: jest.fn(),
    };
    (service as any).loaded.set('npm', mockPlugin);

    const res = await service.ping('npm');
    expect(res!.ok).toBeTruthy();
    expect(res!.capabilities.repoTypes).toContain('hosted');
    expect(res!.capabilities.repoTypes).toContain('proxy');
  });

  describe('context helpers', () => {
    it('getRepo should find repository by name', async () => {
      const mockRepoRepo = {
        findOne: jest.fn().mockResolvedValue({ id: 'r1', name: 'myrepo' }),
      };
      (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepoRepo);

      const context = (service as any).getPluginContext();
      const repo = await context.getRepo('myrepo');
      expect(repo!.name).toBe('myrepo');
    });
  });

  describe('listing and conformance', () => {
    it('should list plugins and handle icons', () => {
      const mockPlugin = { metadata: { key: 'npm', name: 'NPM' } };
      (service as any).loaded.set('npm', mockPlugin);

      // Mock fs.existsSync to return true for icon path
      const fs = require('fs');
      const spy = jest.spyOn(fs, 'existsSync').mockReturnValue(true);

      const list = service.list();
      expect(list[0].icon).toContain('/plugins/npm/icon');
      spy.mockRestore();
    });

    it('should check plugin conformance', () => {
      const validPlugin = {
        metadata: { key: 'p1' },
        upload: () => {},
      } as any;
      const invalidPlugin = { metadata: { key: 'p2' } } as any;

      expect((service as any).isPluginConformant(validPlugin)).toBeTruthy();
      expect((service as any).isPluginConformant(invalidPlugin)).toBeFalsy();
      expect((service as any).isPluginConformant(null)).toBeFalsy();
    });
  });
});
