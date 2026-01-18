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

import { initStorage } from 'src/modules/plugins/impl/helm-plugin/storage/storage';
import * as yaml from 'js-yaml';

jest.mock('src/modules/plugins/impl/helm-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe('HelmPlugin Storage', () => {
  let mockContext: any;
  let storageMethods: ReturnType<typeof initStorage>;
  let mockProxyHelper: jest.Mock;

  beforeEach(() => {
    mockContext = {
      storage: {
        get: jest.fn(),
        save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc123' }),
        exists: jest.fn(),
        saveStream: jest
          .fn()
          .mockResolvedValue({ size: 100, contentHash: 'abc123' }),
      },
      getRepo: jest.fn(),
      indexArtifact: jest.fn(),
    };

    mockProxyHelper = require('src/plugins-core/proxy-helper')
      .default as jest.Mock;
    storageMethods = initStorage(mockContext);
    jest.clearAllMocks();
  });

  describe('upload', () => {
    const repo = { id: 'r1', type: 'hosted' };

    it('should upload chart successfully', async () => {
      const pkg = {
        name: 'nginx',
        version: '1.0.0',
        buffer: Buffer.from('chart data'),
      };

      const result = await storageMethods.upload(repo, pkg);

      expect(result.ok).toBe(true);
      expect(result.id).toBe('nginx-1.0.0.tgz');
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should handle group repo with preferred writer', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'host1',
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted' };
      mockContext.getRepo.mockResolvedValue(hostedRepo);

      const pkg = {
        name: 'nginx',
        version: '1.0.0',
        buffer: Buffer.from('data'),
      };
      const result = await storageMethods.upload(groupRepo, pkg);

      expect(mockContext.getRepo).toHaveBeenCalledWith('host1');
      expect(result.ok).toBe(true);
    });

    it('should reject group with none write policy', async () => {
      const groupRepo = {
        type: 'group',
        config: { writePolicy: 'none' },
      };

      const result = await storageMethods.upload(groupRepo, {});

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Group is read-only');
    });

    it('should handle first write policy', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'first',
          members: ['host1'],
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted' };
      mockContext.getRepo.mockResolvedValue(hostedRepo);

      const pkg = {
        name: 'nginx',
        version: '1.0.0',
        buffer: Buffer.from('data'),
      };
      const result = await storageMethods.upload(groupRepo, pkg);

      expect(result.ok).toBe(true);
    });

    it('should handle mirror write policy', async () => {
      const groupRepo = {
        type: 'group',
        config: {
          writePolicy: 'mirror',
          members: ['host1', 'host2'],
        },
      };
      const hostedRepo = { id: 'host1', type: 'hosted' };
      mockContext.getRepo.mockResolvedValue(hostedRepo);

      const pkg = {
        name: 'nginx',
        version: '1.0.0',
        buffer: Buffer.from('data'),
      };
      const result = await storageMethods.upload(groupRepo, pkg);

      expect(result.ok).toBe(true);
    });
  });

  describe('handlePut', () => {
    const repo = { id: 'r1', type: 'hosted' };

    it('should handle Buffer body', async () => {
      const req = { body: Buffer.from('chart data') };
      const result = await storageMethods.handlePut(
        repo,
        'nginx-1.0.0.tgz',
        req,
      );

      expect(result.ok).toBe(true);
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should handle JSON body', async () => {
      const req = { body: { name: 'nginx', version: '1.0.0' } };
      const result = await storageMethods.handlePut(
        repo,
        'nginx-1.0.0.tgz',
        req,
      );

      expect(result.ok).toBe(true);
    });

    it('should handle string body', async () => {
      const req = { body: 'chart data' };
      const result = await storageMethods.handlePut(
        repo,
        'nginx-1.0.0.tgz',
        req,
      );

      expect(result.ok).toBe(true);
    });
  });

  describe('download', () => {
    const repo = { id: 'r1', type: 'hosted', name: 'helm-repo' };

    it('should download chart from hosted repo', async () => {
      const chartData = Buffer.from('chart content');
      mockContext.storage.exists.mockResolvedValue(true);
      mockContext.storage.get.mockResolvedValue(chartData);

      const result = await storageMethods.download(repo, 'nginx-1.0.0.tgz');

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(chartData);
    });

    it('should download index.yaml', async () => {
      const indexData = Buffer.from('index content');
      mockContext.storage.get.mockResolvedValue(indexData);

      const result = await storageMethods.download(repo, 'index.yaml');

      expect(result.ok).toBe(true);
      expect(result.contentType).toBe('application/x-yaml');
    });

    it('should handle proxy repo download', async () => {
      const proxyRepo = {
        ...repo,
        type: 'proxy',
        config: { url: 'https://charts.helm.sh' },
      };
      const chartData = Buffer.from('chart from upstream');

      mockContext.storage.get.mockResolvedValue(null);
      mockProxyHelper.mockResolvedValue({
        ok: true,
        body: chartData,
        headers: { 'content-type': 'application/gzip' },
      });

      const result = await storageMethods.download(
        proxyRepo,
        'nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(true);
      expect(mockContext.storage.save).toHaveBeenCalled();
    });

    it('should return cached data for proxy repo', async () => {
      const proxyRepo = {
        ...repo,
        type: 'proxy',
        config: { url: 'https://charts.helm.sh' },
      };
      const cachedData = Buffer.from('cached chart');

      mockContext.storage.get.mockResolvedValue(cachedData);

      const result = await storageMethods.download(
        proxyRepo,
        'nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(cachedData);
    });

    it('should handle group repo download', async () => {
      const groupRepo = {
        type: 'group',
        config: { members: ['host1'] },
      };
      const hostedRepo = { id: 'host1', type: 'hosted' };
      mockContext.getRepo.mockResolvedValue(hostedRepo);
      mockContext.storage.exists.mockResolvedValue(true);
      mockContext.storage.get.mockResolvedValue(Buffer.from('data'));

      const result = await storageMethods.download(
        groupRepo,
        'nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(true);
    });

    it('should return not found for missing chart', async () => {
      mockContext.storage.exists.mockResolvedValue(false);

      const result = await storageMethods.download(repo, 'missing-1.0.0.tgz');

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Not found');
    });

    it('should handle proxy repo with no upstream URL', async () => {
      const proxyRepo = { ...repo, type: 'proxy', config: {} };
      mockContext.storage.get.mockResolvedValue(null);

      const result = await storageMethods.download(
        proxyRepo,
        'nginx-1.0.0.tgz',
      );

      expect(result.ok).toBe(false);
      expect(result.message).toBe('No upstream URL');
    });
  });
});
