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

import { ReposService } from 'src/modules/repos/repos.service';
import { RepositoryEntity } from 'src/entities/repository.entity';
import { Artifact } from 'src/entities/artifact.entity';
import { Repository } from 'typeorm';

describe('ReposService (Unit)', () => {
  let service: ReposService;
  let repo: jest.Mocked<Repository<RepositoryEntity>>;
  let artifactRepo: jest.Mocked<Repository<Artifact>>;
  let plugins: any;
  let pluginManager: any;
  let storage: any;
  let auditService: any;
  let repositoryPermissionService: any;
  let licenseService: any;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'r1', ...d })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;

    artifactRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'a1', ...d })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      remove: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;

    plugins = {
      list: jest.fn().mockReturnValue([]),
      getInstance: jest.fn(),
    };

    pluginManager = {
      getUpstreamPingStatus: jest.fn(),
      triggerUpstreamPingForRepo: jest.fn(),
      getPluginForRepo: jest.fn(),
    };

    storage = {
      getDefaultStorageConfig: jest.fn().mockResolvedValue({ id: 'def-s' }),
      list: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue(undefined),
      getUrl: jest.fn().mockResolvedValue('http://file'),
      getMetadata: jest.fn(),
      getAdapterForId: jest.fn(),
      getStream: jest.fn(),
    };

    auditService = {
      logSuccess: jest.fn().mockResolvedValue({}),
    };

    repositoryPermissionService = {};
    licenseService = {};

    service = new ReposService(
      repo,
      artifactRepo,
      plugins,
      pluginManager,
      storage,
      auditService,
      repositoryPermissionService,
      licenseService,
    );
  });

  describe('normalize', () => {
    it('prefers explicit docker accessUrl from config', async () => {
      const ent = {
        id: 'r1',
        name: 'r1',
        manager: 'docker',
        config: { docker: { port: 5012, accessUrl: 'http://custom:5012' } },
      } as any;
      repo.find.mockResolvedValue([ent]);

      const out = await service.findAll();
      expect(out[0].accessUrl).toBe('http://custom:5012');
    });

    it('constructs host:port from environment when accessUrl not provided', async () => {
      process.env.REGISTRY_HOST = 'registry.example';
      process.env.REGISTRY_PROTOCOL = 'https';
      const ent = {
        id: 'r2',
        name: 'r2',
        manager: 'docker',
        config: { docker: { port: 6020 } },
      } as any;
      repo.find.mockResolvedValue([ent]);

      const out = await service.findAll();
      expect(out[0].accessUrl).toBe('https://registry.example:6020');

      delete process.env.REGISTRY_HOST;
      delete process.env.REGISTRY_PROTOCOL;
    });
  });

  describe('CRUD operations', () => {
    it('should create a repository', async () => {
      const data = { name: 'new-repo', manager: 'npm' };
      const saved = await service.create(data);
      expect(saved.name).toBe('new-repo');
      expect(repo.save).toHaveBeenCalled();
      expect(auditService.logSuccess).toHaveBeenCalled();
    });

    it('should find by id or name', async () => {
      const ent = { id: 'r1', name: 'my-repo', manager: 'npm' } as any;
      repo.findOne.mockResolvedValue(ent);

      const res = await service.findOne('my-repo');
      expect(res.name).toBe('my-repo');
    });

    it('should update a repository', async () => {
      const ent = { id: 'r1', name: 'old-name' } as any;
      repo.findOne.mockResolvedValue(ent);

      await service.update('r1', { name: 'new-name' });
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'new-name' }),
      );
    });

    it('should use cache for findOneCached', async () => {
      const ent = { id: 'r1', name: 'my-repo' } as any;
      repo.findOne.mockResolvedValue(ent);

      await service.findOneCached('r1');
      await service.findOneCached('r1');

      expect(repo.findOne).toHaveBeenCalledTimes(1);
    });

    it('should refresh cache after expiration', async () => {
      const ent = { id: 'r1', name: 'my-repo' } as any;
      repo.findOne.mockResolvedValue(ent);

      // First call (Cache Miss)
      await service.findOneCached('r1');
      expect(repo.findOne).toHaveBeenCalledTimes(1);

      // Fast forward time > 10000ms (configured TTL)
      const realDateNow = Date.now;
      Date.now = jest.fn(() => realDateNow() + 15000);

      // Second call (Cache Expired)
      await service.findOneCached('r1');
      expect(repo.findOne).toHaveBeenCalledTimes(2);

      // Restore Date.now
      Date.now = realDateNow;
    });
  });

  describe('Lifecycle (onModuleInit)', () => {
    it('should restart docker registries on init', async () => {
      const dockerRepo = { id: 'd1', name: 'docker-repo', manager: 'docker' };
      const otherRepo = { id: 'n1', name: 'npm-repo', manager: 'npm' };

      repo.find
        .mockResolvedValueOnce([dockerRepo] as any) // first call: where manager=docker
        .mockResolvedValueOnce([dockerRepo, otherRepo] as any); // second call: all repos

      // Mock implementation of manageDockerRegistry to spy on it
      // Since it's private/protected, we can spy on the component method if we cast to any,
      // Or simpler: Mock the logic it depends on.
      // But manageDockerRegistry calls PluginManager, let's spy on that.
      // Actually, manageDockerRegistry is a method on THIS service. We should spy on it or its effects.
      // Let's spy on the service instance prototype cast to any or just check logging if logic is too internal.
      // Better: spy on 'manageDockerRegistry' by assigning it to a mock before init.

      const manageSpy = jest
        .spyOn(service as any, 'manageDockerRegistry')
        .mockResolvedValue(undefined);
      const scanSpy = jest
        .spyOn(service as any, 'scanArtifacts')
        .mockResolvedValue({ count: 0 });
      jest.useFakeTimers();

      await service.onModuleInit();

      expect(repo.find).toHaveBeenCalledWith({ where: { manager: 'docker' } });
      expect(manageSpy).toHaveBeenCalledWith(
        dockerRepo,
        'start',
        expect.any(Map),
      );

      // Verify scan is scheduled
      jest.advanceTimersByTime(5000);
      expect(scanSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  it('should delete a repository and its artifacts', async () => {
    const ent = { id: 'r1', name: 'my-repo', manager: 'npm' } as any;
    const artifact = { id: 'a1' } as any;
    repo.findOne.mockResolvedValue(ent);
    artifactRepo.find.mockResolvedValue([artifact]);
    storage.list.mockResolvedValue(['npm/my-repo/p.tgz']);

    await service.delete('r1');

    expect(artifactRepo.remove).toHaveBeenCalled();
    expect(storage.delete).toHaveBeenCalledWith('npm/my-repo/p.tgz');
    expect(repo.delete).toHaveBeenCalledWith('r1');
    expect(auditService.logSuccess).toHaveBeenCalled();
  });

  describe('Package listing', () => {
    it('should list packages from artifacts', async () => {
      const ent = { id: 'r1', name: 'repo1' } as any;
      repo.findOne.mockResolvedValue(ent);
      artifactRepo.find.mockResolvedValue([
        {
          packageName: 'pkg1',
          version: '1.0',
          size: 100,
          createdAt: new Date(),
        },
      ] as any);

      const list = await service.listPackages('r1');
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('pkg1');
    });

    it('should delegate to plugin if listPackages is supported', async () => {
      const ent = { id: 'r1', name: 'repo1', manager: 'docker' } as any;
      repo.findOne.mockResolvedValue(ent);
      const mockPlugin = {
        listPackages: jest
          .fn()
          .mockResolvedValue({ ok: true, packages: [{ name: 'img1' }] }),
      };
      pluginManager.getPluginForRepo.mockReturnValue(mockPlugin);

      const list = await service.listPackages('r1');
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('img1');
    });
  });

  describe('Validation', () => {
    it('should validate docker port availability', async () => {
      repo.find.mockResolvedValue([
        { config: { docker: { port: 5000 } } },
      ] as any);

      const available = await service.validateDockerPortAvailability(5001);
      expect(available).toBe(true);

      const taken = await service.validateDockerPortAvailability(5000);
      expect(taken).toBe(false);
    });

    it('should validate proxy config', () => {
      expect(service.validateProxyConfig({ target: 'http://upstream' })).toBe(
        true,
      );
      expect(service.validateProxyConfig({ registry: 'http://upstream' })).toBe(
        true,
      );
      expect(service.validateProxyConfig({})).toBe(false);
      expect(service.validateProxyConfig(null)).toBe(false);
    });
  });

  describe('Artifact scanning', () => {
    it('should scan hosted repository for artifacts', async () => {
      const ent = {
        id: 'r1',
        name: 'myrepo',
        manager: 'npm',
        type: 'hosted',
      } as any;
      const mockAdapter = {
        list: jest.fn().mockResolvedValue(['npm/myrepo/pkg/-/pkg-1.0.0.tgz']),
      };
      storage.getAdapterForId.mockResolvedValue(mockAdapter);
      storage.getMetadata.mockResolvedValue({ size: 1024 });

      const res = await service.scanRepoArtifacts(ent);
      expect(res.ok).toBe(true);
      expect(res.count).toBe(1);
      expect(artifactRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: 'pkg',
          version: '1.0.0',
        }),
      );
    });

    it('should handle maven artifacts correctly', async () => {
      const ent = {
        id: 'r1',
        name: 'mvn',
        manager: 'maven',
        type: 'hosted',
      } as any;
      const mockAdapter = {
        list: jest
          .fn()
          .mockResolvedValue(['maven/mvn/org/example/pkg/1.0/pkg-1.0.jar']),
      };
      storage.getAdapterForId.mockResolvedValue(mockAdapter);

      const res = await service.scanRepoArtifacts(ent);
      expect(res.count).toBe(1);
      expect(artifactRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          packageName: 'org.example:pkg',
          version: '1.0',
        }),
      );
    });
  });

  describe('Package details', () => {
    it('should get package details from DB', async () => {
      const ent = { id: 'r1', name: 'repo1', manager: 'npm' } as any;
      repo.findOne.mockResolvedValue(ent);
      artifactRepo.find.mockResolvedValue([
        {
          id: 'a1',
          packageName: 'pkg',
          version: '1.0',
          storageKey: 'k1',
          size: 100,
          createdAt: new Date(),
        },
      ] as any);
      storage.getUrl.mockResolvedValue('http://download');

      const res = await service.getPackageDetails('r1', 'pkg');
      expect(res.ok).toBe(true);
      expect(res.artifacts).toHaveLength(1);
      expect(res.artifacts[0].url).toBe('http://download');
    });

    it('should support install commands via plugin', async () => {
      const ent = { id: 'r1', name: 'repo1', manager: 'npm' } as any;
      repo.findOne.mockResolvedValue(ent);
      artifactRepo.find.mockResolvedValue([
        { packageName: 'pkg', version: '1.0' },
      ] as any);

      const mockPlugin = {
        getInstallCommand: jest.fn().mockResolvedValue('npm install pkg@1.0'),
      };
      plugins.getInstance.mockReturnValue(mockPlugin);

      const res = await service.getPackageDetails('r1', 'pkg');
      expect(res.artifacts[0].installCommand).toBe('npm install pkg@1.0');
    });

    it('should delete a package version', async () => {
      const ent = { id: 'r1', name: 'repo1' } as any;
      repo.findOne.mockResolvedValue(ent);
      artifactRepo.findOne.mockResolvedValue({
        id: 'a1',
        storageKey: 'k1',
      } as any);

      const res = await service.deletePackageVersion('r1', 'pkg', '1.0');
      expect(res.ok).toBe(true);
      expect(artifactRepo.delete).toHaveBeenCalled();
      expect(storage.delete).toHaveBeenCalledWith('k1');
    });

    it('should delete a path (multiple versions)', async () => {
      const ent = { id: 'r1', name: 'repo1' } as any;
      repo.findOne.mockResolvedValue(ent);
      artifactRepo.find.mockResolvedValue([
        { packageName: 'pkg/a', version: '1.0' },
        { packageName: 'pkg/b', version: '2.0' },
      ] as any);
      artifactRepo.findOne.mockResolvedValue({ id: 'a1' } as any);

      const res = await service.deletePath('r1', 'pkg');
      expect(res.ok).toBe(true);
      expect(res.count).toBe(2);
      expect(artifactRepo.delete).toHaveBeenCalledTimes(2);
    });

    it('should verify artifact content hash', async () => {
      const artifact = {
        id: 'a1',
        storageKey: 'k1',
        contentHash:
          'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      };
      artifactRepo.findOne.mockResolvedValue(artifact as any);
      repo.findOne.mockResolvedValue({ id: 'r1' } as any);

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from('');
        },
      };
      storage.getStream.mockResolvedValue({ stream: mockStream });

      const res = await service.verify('r1', 'k1');
      expect(res.ok).toBe(true);
      expect(res.match).toBe(true);
    });

    it('should attach provenance to an artifact', async () => {
      const artifact = { id: 'a1', metadata: {} };
      artifactRepo.findOne.mockResolvedValue(artifact as any);
      repo.findOne.mockResolvedValue({ id: 'r1' } as any);

      const res = await service.attachProvenance('r1', 'k1', { buildId: 'b1' });
      expect(res.ok).toBe(true);
      expect(artifactRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({
            provenance: expect.objectContaining({ buildId: 'b1' }),
          }),
        }),
      );
    });
  });
});
