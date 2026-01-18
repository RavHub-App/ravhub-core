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

import { MonitorService } from 'src/modules/monitor/monitor.service';
import AppDataSource from 'src/data-source';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
  },
}));

describe('MonitorService (Unit)', () => {
  let service: MonitorService;
  let mockMetricRepo: any;
  let mockRepoRepo: any;
  let mockArtifactRepo: any;

  beforeEach(() => {
    mockMetricRepo = {
      find: jest.fn(),
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'm1', ...d })),
      createQueryBuilder: jest.fn(),
    };
    mockRepoRepo = {
      find: jest.fn().mockResolvedValue([]),
    };
    mockArtifactRepo = {
      count: jest.fn().mockResolvedValue(0),
      find: jest.fn().mockResolvedValue([]),
    };

    const getRepoMock = (entity: any) => {
      if (entity.name === 'Metric') return mockMetricRepo;
      if (entity.name === 'RepositoryEntity') return mockRepoRepo;
      if (entity.name === 'Artifact') return mockArtifactRepo;
      return null;
    };
    (AppDataSource.getRepository as jest.Mock).mockImplementation(getRepoMock);

    service = new MonitorService(mockMetricRepo);
  });

  it('should record a metric', async () => {
    const res = await service.recordMetric('test', 1);
    expect(res.key).toBe('test');
    expect(mockMetricRepo.save).toHaveBeenCalled();
  });

  it('should aggregate metrics', async () => {
    const mockQB: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest
        .fn()
        .mockResolvedValue([{ key: 'uploads.r1', total: 10 }]),
    };
    mockMetricRepo.createQueryBuilder.mockReturnValue(mockQB);

    const res = await service.aggregate();
    expect(res).toHaveLength(1);
    expect(res[0].key).toBe('uploads.r1');
  });

  it('should get detailed metrics', async () => {
    // Aggregate returns some data
    const mockQB: any = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        { key: 'uploads.r1', total: 10 },
        { key: 'downloads.r1', total: 5 },
        { key: 'proxy_cache_hit', total: 100 },
      ]),
    };
    mockMetricRepo.createQueryBuilder.mockReturnValue(mockQB);

    mockRepoRepo.find.mockResolvedValue([{ id: 'r1', type: 'hosted' }]);
    mockArtifactRepo.count.mockResolvedValue(20);

    const res = await service.getDetailedMetrics();
    expect(res.totalUploads).toBe(10);
    expect(res.totalDownloads).toBe(5);
    expect(res.proxyMetrics.hits).toBe(100);
    expect(res.repoCount).toBe(1);
  });

  it('should increment a metric', async () => {
    await service.increment('inc_key');
    expect(mockMetricRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'inc_key',
        value: 1,
      }),
    );
  });

  it('should get basic metrics', async () => {
    mockMetricRepo.find.mockResolvedValue([{ key: 'k1', value: 1 }]);
    const res = await service.getBasicMetrics();
    expect(res.uptime).toBeDefined();
    expect(res.recent).toHaveLength(1);
  });

  it('should get recent artifacts', async () => {
    const mockArtifact = {
      id: 'a1',
      packageName: 'pkg',
      version: '1.0',
      size: '500',
      createdAt: new Date(),
      repository: { id: 'r1', name: 'repo1', type: 'hosted' },
    };
    mockArtifactRepo.find.mockResolvedValue([mockArtifact]);

    const res = await service.getRecentArtifacts(1);
    expect(res).toHaveLength(1);
    expect(res[0].name).toBe('pkg');
  });
});
