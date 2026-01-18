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

import { StorageService } from 'src/modules/storage/storage.service';
import AppDataSource from 'src/data-source';
import { FilesystemStorageAdapter } from 'src/storage/filesystem-storage.adapter';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
  },
}));

jest.mock('src/storage/filesystem-storage.adapter', () => {
  return {
    FilesystemStorageAdapter: jest.fn().mockImplementation(() => ({
      save: jest.fn().mockResolvedValue(undefined),
      get: jest.fn(),
      delete: jest.fn().mockResolvedValue(undefined),
      exists: jest.fn(),
      list: jest.fn(),
      getMetadata: jest.fn(),
      getUrl: jest.fn().mockResolvedValue('file://test'),
    })),
  };
});

describe('StorageService (Unit)', () => {
  let service: StorageService;
  let mockRedlock: any;
  let mockAdapter: any;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRedlock = {
      runWithLock: jest.fn().mockImplementation((_k, _t, f) => f()),
    };
    service = new StorageService(mockRedlock);
    await service.onModuleInit();
    // Since we cleared mocks, we need to find the instance created in onModuleInit
    mockAdapter = (FilesystemStorageAdapter as jest.Mock).mock.results[0].value;
  });

  it('should initialize with default filesystem adapter', async () => {
    expect(FilesystemStorageAdapter).toHaveBeenCalled();
  });

  it('should save data using default adapter', async () => {
    await service.save('test.txt', 'hello');
    expect(mockAdapter.save).toHaveBeenCalledWith('test.txt', 'hello');
  });

  it('should get data using default adapter', async () => {
    mockAdapter.get.mockResolvedValue(Buffer.from('hello'));

    const data = await service.get('test.txt');
    expect(data?.toString()).toBe('hello');
    expect(mockAdapter.get).toHaveBeenCalledWith('test.txt');
  });

  it('should delete data using default adapter', async () => {
    await service.delete('test.txt');
    expect(mockAdapter.delete).toHaveBeenCalledWith('test.txt');
  });

  it('should check existence using default adapter', async () => {
    mockAdapter.exists.mockResolvedValue(true);

    const exists = await service.exists('test.txt');
    expect(exists).toBe(true);
    expect(mockAdapter.exists).toHaveBeenCalledWith('test.txt');
  });

  it('should list files using default adapter', async () => {
    mockAdapter.list.mockResolvedValue(['a.txt', 'b.txt']);

    const files = await service.list('prefix/');
    expect(files).toEqual(['a.txt', 'b.txt']);
    expect(mockAdapter.list).toHaveBeenCalledWith('prefix/');
  });

  it('should get metadata using default adapter', async () => {
    const meta = { size: 100, mtime: new Date() };
    mockAdapter.getMetadata.mockResolvedValue(meta);

    const result = await service.getMetadata('test.txt');
    expect(result).toEqual(meta);
    expect(mockAdapter.getMetadata).toHaveBeenCalledWith('test.txt');
  });

  it('should cache small files', async () => {
    const smallData = Buffer.from('small');
    mockAdapter.get.mockResolvedValue(smallData);

    await service.get('small.txt');
    await service.get('small.txt');

    // Should only call adapter once because of caching
    expect(mockAdapter.get).toHaveBeenCalledTimes(1);
  });

  describe('repository storage configuration', () => {
    let mockRepoRepo: any;
    let mockCfgRepo: any;

    beforeEach(() => {
      mockRepoRepo = {
        findOne: jest.fn(),
      };
      mockCfgRepo = {
        findOne: jest.fn(),
        findOneBy: jest.fn(),
      };
      (AppDataSource.getRepository as jest.Mock).mockImplementation(
        (entity) => {
          if (entity.name === 'RepositoryEntity') return mockRepoRepo;
          if (entity.name === 'StorageConfig') return mockCfgRepo;
          return {};
        },
      );
    });

    it('should use default adapter if repository not found', async () => {
      mockRepoRepo.findOne.mockResolvedValue(null);
      mockCfgRepo.findOne.mockResolvedValue(null); // No default either

      // Using any key that doesn't trigger common naming conventions if needed,
      // but normally it splits by / and looks at parts[1]
      const adapter = await (service as any).getAdapterForKey(
        'npm/myrepo/pkg.tgz',
      );
      expect(adapter).toBe(mockAdapter);
    });

    it('should use specific storage for repository', async () => {
      const mockRepo = {
        id: 'r1',
        name: 'myrepo',
        config: { storageId: 's1' },
      };
      const mockCfg = {
        id: 's1',
        key: 's1',
        type: 'filesystem',
        config: { basePath: '/data/s1' },
      };

      mockRepoRepo.findOne.mockResolvedValue(mockRepo);
      mockCfgRepo.findOneBy.mockResolvedValue(mockCfg);

      const adapter = await (service as any).getAdapterForKey(
        'npm/myrepo/pkg.tgz',
      );

      // It should have created a NEW FilesystemStorageAdapter for /data/s1
      expect(FilesystemStorageAdapter).toHaveBeenCalledTimes(2); // Initial default + this one
      expect(FilesystemStorageAdapter).toHaveBeenCalledWith('/data/s1');
    });
  });

  describe('migration', () => {
    it('should migrate files between adapters', async () => {
      const mockSource = {
        list: jest.fn().mockResolvedValue(['file1.bin', 'file2.bin']),
        get: jest.fn().mockResolvedValue(Buffer.from('content')),
      };
      const mockDest = {
        save: jest.fn().mockResolvedValue(undefined),
      };

      // Mock getAdapterForId to return our mocks
      jest
        .spyOn(service, 'getAdapterForId')
        .mockResolvedValueOnce(mockSource as any)
        .mockResolvedValueOnce(mockDest as any);

      await service.migrate('prefix', 'oldId', 'newId');

      expect(mockSource.list).toHaveBeenCalledWith('prefix');
      expect(mockSource.get).toHaveBeenCalledTimes(2);
      expect(mockDest.save).toHaveBeenCalledTimes(2);
      expect(mockRedlock.runWithLock).toHaveBeenCalled();
    });

    it('should skip migration if same storage ID', async () => {
      await service.migrate('prefix', 'same', 'same');
      expect(mockRedlock.runWithLock).not.toHaveBeenCalled();
    });
  });
});
