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

import { initStorage } from 'src/modules/plugins/impl/npm-plugin/storage/storage';
import { Repository } from 'src/modules/plugins/impl/npm-plugin/utils/types';

jest.mock('src/modules/plugins/impl/npm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/modules/plugins/impl/npm-plugin/utils/metadata', () => ({
  mergeMetadata: jest.fn((current, incoming) => ({
    ...current,
    ...incoming,
    versions: { ...current?.versions, ...incoming.versions },
  })),
  createInitialMetadata: jest.fn((name) => ({
    name,
    versions: {},
    'dist-tags': {},
  })),
}));

describe('NpmPlugin Storage', () => {
  let mockStorage: any;
  let mockContext: any;
  let storageMethods: ReturnType<typeof initStorage>;

  beforeEach(() => {
    mockStorage = {
      get: jest.fn(),
      save: jest
        .fn()
        .mockResolvedValue({ ok: true, size: 100, contentHash: 'abc123' }),
      saveStream: jest
        .fn()
        .mockResolvedValue({ ok: true, size: 100, path: 'test/path' }),
    };
    mockContext = {
      storage: mockStorage,
      getRepo: jest.fn(),
    };
    storageMethods = initStorage(mockContext);
    jest.clearAllMocks();
  });

  describe('handlePut', () => {
    const repo: Repository = { id: 'r1', type: 'hosted', config: {} } as any;

    it('should reject group with none write policy', async () => {
      const groupRepo = {
        ...repo,
        type: 'group',
        config: { writePolicy: 'none' },
      };
      const result = await storageMethods.handlePut(
        groupRepo as any,
        'pkg',
        {} as any,
      );

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Group is read-only');
    });

    it('should handle tarball upload via stream', async () => {
      const mockReq = {
        on: jest.fn((event, handler) => {
          if (event === 'end') setTimeout(() => handler(), 0);
          return mockReq;
        }),
      };

      const result = await storageMethods.handlePut(
        repo,
        'pkg/-/pkg-1.0.0.tgz',
        mockReq,
      );

      expect(result.ok).toBe(true);
      expect(mockStorage.saveStream).toHaveBeenCalled();
    });

    it('should handle metadata upload with attachments', async () => {
      const metadata = {
        name: 'test-pkg',
        versions: { '1.0.0': {} },
        _attachments: {
          'test-pkg-1.0.0.tgz': {
            data: Buffer.from('test').toString('base64'),
          },
        },
      };

      const mockReq = {
        body: metadata,
      };

      mockStorage.get.mockResolvedValue(null);

      const result = await storageMethods.handlePut(repo, 'test-pkg', mockReq);

      expect(result.ok).toBe(true);
      expect(result.message).toBe('Package published');
      expect(mockStorage.save).toHaveBeenCalledTimes(2); // metadata + attachment
    });

    it('should merge with existing metadata', async () => {
      const existing = JSON.stringify({
        name: 'test-pkg',
        versions: { '1.0.0': {} },
      });
      mockStorage.get.mockResolvedValue(Buffer.from(existing));

      const newVersion = {
        name: 'test-pkg',
        versions: { '2.0.0': {} },
      };

      const mockReq = { body: newVersion };

      const result = await storageMethods.handlePut(repo, 'test-pkg', mockReq);

      expect(result.ok).toBe(true);
    });

    it('should handle invalid JSON', async () => {
      const mockReq = {
        body: 'invalid json',
        on: jest.fn((event, handler) => {
          if (event === 'data') handler(Buffer.from('invalid'));
          if (event === 'end') setTimeout(() => handler(), 0);
          return mockReq;
        }),
      };

      const result = await storageMethods.handlePut(repo, 'test-pkg', mockReq);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Invalid JSON');
    });

    it('should delegate to first hosted member in group', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'first',
          members: ['m1', 'm2'],
        },
      };
      const hostedMember = { id: 'm1', type: 'hosted', config: {} };
      mockContext.getRepo.mockResolvedValue(hostedMember);
      const result = await storageMethods.handlePut(
        groupRepo as any,
        'pkg/-/test.tgz',
        { body: 'data' } as any,
      );
      expect(result.ok).toBe(true);
    });

    it('should handle preferred writer in group', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'm2',
          members: ['m1', 'm2'],
        },
      };
      const preferred = { id: 'm2', type: 'hosted', config: {} };
      mockContext.getRepo.mockImplementation((id) =>
        id === 'm2' ? Promise.resolve(preferred) : Promise.resolve(null),
      );
      const result = await storageMethods.handlePut(
        groupRepo as any,
        'pkg/-/test.tgz',
        { body: 'data' } as any,
      );
      expect(result.ok).toBe(true);
    });

    it('should handle mirror writer in group', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'mirror',
          members: ['m1', 'm2'],
        },
      };
      mockContext.getRepo.mockResolvedValue({
        id: 'm1',
        type: 'hosted',
        config: {},
      });
      const result = await storageMethods.handlePut(
        groupRepo as any,
        'pkg/-/test.tgz',
        { body: 'data' } as any,
      );
      expect(result.ok).toBe(true);
    });

    it('should handle unknown write policy', async () => {
      const groupRepo = { type: 'group', config: { writePolicy: 'invalid' } };
      const result = await storageMethods.handlePut(groupRepo as any, 'pkg', {
        body: {},
      } as any);
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Unknown write policy');
    });

    it('should fallback to streamToBuffer if saveStream is missing', async () => {
      delete mockStorage.saveStream;
      const mockReq = {
        on: jest.fn((event, handler) => {
          if (event === 'end') setTimeout(() => handler(), 0);
          return mockReq;
        }),
      };
      const result = await storageMethods.handlePut(
        repo,
        'pkg/-/pkg.tgz',
        mockReq,
      );
      expect(result.ok).toBe(true);
      expect(mockStorage.save).toHaveBeenCalled();
    });

    it('should handle indexing error gracefully', async () => {
      mockContext.indexArtifact = jest
        .fn()
        .mockRejectedValue(new Error('fail'));
      const metadata = { name: 'pkg', versions: { '1.0.0': {} } };
      const result = await storageMethods.handlePut(repo, 'pkg', {
        body: metadata,
      } as any);
      expect(result.ok).toBe(true);
    });
  });

  describe('download', () => {
    const repo: Repository = {
      id: 'r1',
      name: 'npm-repo',
      type: 'hosted',
      config: {},
    } as any;

    it('should download package metadata', async () => {
      const metadata = JSON.stringify({ name: 'test-pkg', versions: {} });
      mockStorage.get.mockResolvedValue(Buffer.from(metadata));

      const result = await storageMethods.download(repo, 'test-pkg');

      expect(result.ok).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.contentType).toBe('application/json');
    });

    it('should download tarball', async () => {
      const tarball = Buffer.from('tarball content');
      mockStorage.get.mockResolvedValue(tarball);

      const result = await storageMethods.download(repo, 'pkg/-/pkg-1.0.0.tgz');

      expect(result.ok).toBe(true);
      expect(result.contentType).toBe('application/octet-stream');
    });

    it('should return not found for missing package', async () => {
      mockStorage.get.mockResolvedValue(null);

      const result = await storageMethods.download(repo, 'missing-pkg');

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Not found');
    });

    it('should handle proxy repository', async () => {
      const proxyRepo = { ...repo, type: 'proxy' };
      const mockProxyFetch = jest.fn().mockResolvedValue({
        status: 200,
        body: Buffer.from('data'),
        headers: { 'content-type': 'application/json' },
      });

      const storageWithProxy = initStorage(mockContext, mockProxyFetch);
      const result = await storageWithProxy.download(
        proxyRepo as any,
        'test-pkg',
      );

      expect(result.ok).toBe(true);
      expect(mockProxyFetch).toHaveBeenCalled();
    });

    it('should iterate through group members', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          members: ['m1', 'm2'],
        },
      };
      const hostedMember = { id: 'm1', type: 'hosted', name: 'hosted' };
      mockContext.getRepo.mockResolvedValue(hostedMember);
      mockStorage.get.mockResolvedValue(Buffer.from('data'));
      const result = await storageMethods.download(
        groupRepo as any,
        'test-pkg',
      );
      expect(result.ok).toBe(true);
    });

    it('should handle proxy not found', async () => {
      const proxyRepo = { type: 'proxy' };
      const mockProxyFetch = jest.fn().mockResolvedValue({ status: 404 });
      const storageWithProxy = initStorage(mockContext, mockProxyFetch);
      const result = await storageWithProxy.download(
        proxyRepo as any,
        'test-pkg',
      );
      expect(result.ok).toBe(false);
    });

    it('should handle getFile fallback to repo name', async () => {
      mockStorage.get.mockImplementation((key) => {
        if (key.includes('r1')) return Promise.resolve(null);
        return Promise.resolve(Buffer.from('data'));
      });
      const result = await storageMethods.download(repo, 'test-pkg');
      expect(result.ok).toBe(true);
    });
  });
});
