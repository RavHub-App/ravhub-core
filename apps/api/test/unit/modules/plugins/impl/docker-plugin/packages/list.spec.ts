/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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
  initPackages,
  listPackages,
  getPackage,
  listVersions,
  getInstallCommand,
} from 'src/modules/plugins/impl/docker-plugin/packages/list';
import { Repository } from 'src/modules/plugins/impl/docker-plugin/utils/types';
import * as dockerProxyFetchModule from 'src/modules/plugins/impl/docker-plugin/proxy/fetch';

jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('DockerPlugin Packages', () => {
  let mockStorage: any;
  let mockGetRepo: jest.Mock;
  let mockProxyFetch: jest.Mock;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
      get: jest.fn(),
    };
    mockGetRepo = jest.fn();
    mockProxyFetch = jest.fn();

    initPackages({
      storage: mockStorage,
      getRepo: mockGetRepo,
      proxyFetch: mockProxyFetch,
    });
    jest.clearAllMocks();
  });

  describe('listPackages', () => {
    const repo: Repository = {
      id: 'r1',
      name: 'docker-repo',
      type: 'hosted',
    } as any;

    it('should list packages from hosted repo', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
        'docker/r1/redis/manifests/alpine',
      ]);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(2);
      expect(result.packages?.map((p) => p.name)).toContain('nginx');
      expect(result.packages?.map((p) => p.name)).toContain('redis');
    });

    it('should filter out digest-based keys', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/sha256:abc123',
      ]);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(1);
      expect(result.packages?.[0].latestVersion).toBe('latest');
    });

    it('should ignore URL-encoded digest tags when listing packages', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/ravhub/api/manifests/latest',
        'docker/r1/ravhub/api/manifests/sha256%3Aabc123',
      ]);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(1);
      expect(result.packages?.[0]).toEqual(
        expect.objectContaining({
          name: 'ravhub/api',
          latestVersion: 'latest',
        }),
      );
    });

    it('should handle group repo', async () => {
      const groupRepo: Repository = {
        type: 'group',
        config: { members: ['host1', 'host2'] },
      } as any;

      const hostedRepo: Repository = { id: 'host1', type: 'hosted' } as any;
      mockGetRepo.mockResolvedValue(hostedRepo);
      mockStorage.list.mockResolvedValue([
        'docker/host1/nginx/manifests/latest',
      ]);

      const result = await listPackages(groupRepo);

      expect(result.ok).toBe(true);
      expect(mockGetRepo).toHaveBeenCalled();
    });

    it('should return empty array for group with no members', async () => {
      const groupRepo: Repository = {
        type: 'group',
        config: { members: [] },
      } as any;

      const result = await listPackages(groupRepo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([]);
    });

    it('should continue listing when legacy debug lookup fails', async () => {
      mockStorage.list
        .mockRejectedValueOnce(new Error('legacy fail'))
        .mockResolvedValueOnce(['docker/r1/nginx/manifests/latest']);

      const result = await listPackages(repo);

      expect(result.ok).toBe(true);
      expect(result.packages).toHaveLength(1);
      expect(result.packages?.[0].name).toBe('nginx');
    });

    it('should list proxy packages from cached tags list when manifests are missing', async () => {
      const proxyRepo: Repository = {
        id: 'p1',
        name: 'proxy-repo',
        type: 'proxy',
      } as any;

      mockStorage.list
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['docker/p1/library/nginx/tags/list']);
      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'docker/p1/library/nginx/tags/list') {
          return Buffer.from(
            JSON.stringify({
              name: 'library/nginx',
              tags: ['1.2.3', 'latest'],
            }),
          );
        }
        return null;
      });

      const result = await listPackages(proxyRepo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([
        expect.objectContaining({
          name: 'library/nginx',
          latestVersion: 'latest',
        }),
      ]);
    });

    it('should continue aggregating group packages when one member fails', async () => {
      const groupRepo: Repository = {
        id: 'g1',
        type: 'group',
        config: { members: ['host1', 'host2'] },
      } as any;

      mockGetRepo.mockImplementation(async (id: string) => ({
        id,
        name: id,
        type: 'hosted',
      }));
      mockStorage.list
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('host1 fail'))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['docker/host2/redis/manifests/latest']);

      const result = await listPackages(groupRepo);

      expect(result.ok).toBe(true);
      expect(result.packages).toEqual([
        expect.objectContaining({ name: 'redis', latestVersion: 'latest' }),
      ]);
    });
  });

  describe('getPackage', () => {
    const repo: Repository = {
      id: 'r1',
      accessUrl: 'http://localhost:5000',
    } as any;

    it('should get package with all tags', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
      ]);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            layers: [{ size: 1000 }, { size: 2000 }],
            config: { size: 500 },
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toHaveLength(2);
      expect(result.artifacts?.[0].installCommand).toContain('docker pull');
    });

    it('should calculate size from manifest', async () => {
      mockStorage.list.mockResolvedValue(['docker/r1/nginx/manifests/latest']);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            layers: [{ size: 1000 }, { size: 2000 }],
            config: { size: 500 },
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.artifacts?.[0].size).toBe(3500);
    });

    it('should handle manifest list', async () => {
      mockStorage.list.mockResolvedValue(['docker/r1/nginx/manifests/latest']);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({
            manifests: [{ size: 5000 }, { size: 3000 }],
          }),
        ),
      );

      const result = await getPackage(repo, 'nginx');

      expect(result.artifacts?.[0].size).toBe(8000);
    });

    it('should fallback to cached tags list when proxy manifests are missing', async () => {
      const proxyRepo: Repository = {
        id: 'p1',
        type: 'proxy',
        accessUrl: 'http://registry.example.com',
      } as any;

      mockStorage.list.mockResolvedValue([]);
      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'docker/p1/library/nginx/tags/list') {
          return Buffer.from(
            JSON.stringify({
              name: 'library/nginx',
              tags: ['latest', '1.2.3'],
            }),
          );
        }
        return null;
      });

      const result = await getPackage(proxyRepo, 'library/nginx');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toEqual([
        expect.objectContaining({
          version: 'latest',
          installCommand:
            'docker pull registry.example.com/library/nginx:latest',
          size: 0,
        }),
        expect.objectContaining({
          version: '1.2.3',
          installCommand:
            'docker pull registry.example.com/library/nginx:1.2.3',
          size: 0,
        }),
      ]);
    });

    it('should read legacy repo-name manifest paths when repo id has no manifests', async () => {
      const legacyRepo: Repository = {
        id: 'r1',
        name: 'docker-repo',
        type: 'hosted',
        accessUrl: 'http://registry.example.com',
      } as any;

      mockStorage.list.mockImplementation(async (prefix: string) => {
        if (prefix === 'docker/r1/nginx/manifests/') {
          return [];
        }
        if (prefix === 'docker/docker-repo/nginx/manifests/') {
          return ['docker/docker-repo/nginx/manifests/latest'];
        }
        return [];
      });
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({ layers: [{ size: 100 }], config: { size: 50 } }),
        ),
      );

      const result = await getPackage(legacyRepo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toEqual([
        expect.objectContaining({
          version: 'latest',
          size: 150,
          installCommand: 'docker pull registry.example.com/nginx:latest',
        }),
      ]);
    });

    it('should continue aggregating group package artifacts when one member fails', async () => {
      const groupRepo: Repository = {
        id: 'g1',
        type: 'group',
        accessUrl: 'http://registry.example.com',
        config: { members: ['host1', 'host2'] },
      } as any;

      mockGetRepo.mockImplementation(async (id: string) => ({
        id,
        name: id,
        type: 'hosted',
        accessUrl: `http://${id}.example.com`,
      }));
      mockStorage.list
        .mockRejectedValueOnce(new Error('host1 fail'))
        .mockResolvedValueOnce(['docker/host2/nginx/manifests/latest']);
      mockStorage.get.mockResolvedValue(
        Buffer.from(
          JSON.stringify({ layers: [{ size: 100 }], config: { size: 50 } }),
        ),
      );

      const result = await getPackage(groupRepo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.artifacts).toHaveLength(1);
      expect(result.artifacts?.[0].installCommand).toContain(
        'registry.example.com/nginx:latest',
      );
    });
  });

  describe('listVersions', () => {
    const repo: Repository = { id: 'r1', name: 'docker-repo' } as any;

    it('should list versions for an image', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/1.0.0',
        'docker/r1/nginx/manifests/1.1.0',
      ]);

      const result = await listVersions(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('latest');
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('1.1.0');
    });

    it('should filter out digest tags', async () => {
      mockStorage.list.mockResolvedValue([
        'docker/r1/nginx/manifests/latest',
        'docker/r1/nginx/manifests/sha256:abc123',
      ]);

      const result = await listVersions(repo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['latest']);
    });

    it('should continue aggregating group versions when one member fails', async () => {
      const groupRepo: Repository = {
        id: 'g1',
        type: 'group',
        config: { members: ['host1', 'host2'] },
      } as any;

      mockGetRepo.mockImplementation(async (id: string) => ({
        id,
        name: id,
        type: 'hosted',
      }));
      mockStorage.list.mockImplementation(async (prefix: string) => {
        if (prefix === 'docker/host1/nginx/manifests/') {
          throw new Error('host1 fail');
        }
        if (prefix === 'docker/host2/nginx/manifests/') {
          return ['docker/host2/nginx/manifests/latest'];
        }
        return [];
      });

      const result = await listVersions(groupRepo, 'nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['latest']);
    });

    it('should warn and fallback to cached tags when manifest listing fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const proxyRepo: Repository = {
        id: 'p1',
        name: 'proxy-repo',
        type: 'proxy',
        config: { proxyUrl: 'http://up' },
      } as any;

      mockStorage.list.mockRejectedValue(new Error('list-fail'));
      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'docker/p1/library/nginx/tags/list') {
          return Buffer.from(
            JSON.stringify({ name: 'library/nginx', tags: ['stable'] }),
          );
        }
        return null;
      });

      const result = await listVersions(proxyRepo, 'library/nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['stable']);
      expect(warnSpy).toHaveBeenCalledWith(
        '[LIST VERSIONS] Failed to list manifests under docker/p1/library/nginx/manifests/: Error: list-fail',
      );
      warnSpy.mockRestore();
    });

    it('should fetch proxy tags from upstream when local cache is empty', async () => {
      const proxyRepo: Repository = {
        id: 'p1',
        name: 'proxy-repo',
        type: 'proxy',
        config: { proxyUrl: 'http://up' },
      } as any;

      mockStorage.list.mockResolvedValue([]);
      mockProxyFetch.mockResolvedValue({
        ok: true,
        body: Buffer.from(
          JSON.stringify({ name: 'library/nginx', tags: ['latest', '1.0.0'] }),
        ),
      });

      const result = await listVersions(proxyRepo, 'library/nginx');

      expect(mockProxyFetch).toHaveBeenCalledWith(
        proxyRepo,
        'http://up/v2/library/nginx/tags/list',
      );
      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['latest', '1.0.0']);
    });

    it('should read proxy cached tags list from storage before upstream', async () => {
      const proxyRepo: Repository = {
        id: 'p1',
        name: 'proxy-repo',
        type: 'proxy',
        config: { proxyUrl: 'http://up' },
      } as any;

      mockStorage.list.mockResolvedValue([]);
      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'docker/p1/library/nginx/tags/list') {
          return Buffer.from(
            JSON.stringify({
              name: 'library/nginx',
              tags: ['stable', '1.2.3'],
            }),
          );
        }
        return null;
      });

      const result = await listVersions(proxyRepo, 'library/nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['stable', '1.2.3']);
      expect(mockProxyFetch).not.toHaveBeenCalled();
    });

    it('should warn and fallback to upstream when cached tags payload is invalid', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const proxyRepo: Repository = {
        id: 'p1',
        name: 'proxy-repo',
        type: 'proxy',
        config: { proxyUrl: 'http://up' },
      } as any;

      mockStorage.list.mockResolvedValue([]);
      mockStorage.get.mockImplementation(async (key: string) => {
        if (key === 'docker/p1/library/nginx/tags/list') {
          return Buffer.from('{broken json');
        }
        return null;
      });
      mockProxyFetch.mockResolvedValue({
        ok: true,
        body: Buffer.from(
          JSON.stringify({ name: 'library/nginx', tags: ['latest', '1.0.0'] }),
        ),
      });

      const result = await listVersions(proxyRepo, 'library/nginx');

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual(['latest', '1.0.0']);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[LIST VERSIONS] Failed to read cached tags from docker/p1/library/nginx/tags/list:',
        ),
      );
      warnSpy.mockRestore();
    });
  });

  describe('getInstallCommand', () => {
    const repo: Repository = { accessUrl: 'http://localhost:5000' } as any;

    it('should generate install commands', async () => {
      const pkg = { name: 'nginx', version: 'latest' };
      const commands = await getInstallCommand(repo, pkg);

      expect(commands).toHaveLength(3);
      expect(commands[0].label).toBe('docker pull');
      expect(commands[0].command).toContain(
        'docker pull localhost:5000/nginx:latest',
      );
      expect(commands[1].label).toBe('skopeo copy');
      expect(commands[2].label).toBe('Kubernetes (deployment)');
    });

    it('should strip protocol from accessUrl', async () => {
      const repoWithHttps: Repository = {
        accessUrl: 'https://registry.example.com',
      } as any;
      const pkg = { name: 'myimage', version: '1.0.0' };

      const commands = await getInstallCommand(repoWithHttps, pkg);

      expect(commands[0].command).toContain(
        'registry.example.com/myimage:1.0.0',
      );
      expect(commands[0].command).not.toContain('https://');
    });
  });
});
