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
import { ProxyCacheJobService } from 'src/modules/plugins/proxy-cache-job.service';
import { ProxyCacheService } from 'src/modules/plugins/proxy-cache.service';
import { AuditService } from 'src/modules/audit/audit.service';
import AppDataSource from 'src/data-source';

// Mock dependencies
jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
    createQueryRunner: jest.fn(),
  },
}));

jest.mock(
  'src/entities/job.entity',
  () => ({
    Job: class Job {},
  }),
  { virtual: true },
);

describe('ProxyCacheJobService', () => {
  let service: ProxyCacheJobService;
  let proxyCacheService: jest.Mocked<ProxyCacheService>;
  let auditService: jest.Mocked<AuditService>;
  let mockJobRepo: any;
  let mockQueryRunner: any;

  beforeEach(async () => {
    jest.useFakeTimers();

    mockJobRepo = {
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
    };

    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockJobRepo);

    mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      query: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
    };

    (AppDataSource.createQueryRunner as jest.Mock).mockReturnValue(
      mockQueryRunner,
    );

    proxyCacheService = {
      executeProxyCacheCleanup: jest.fn(),
    } as any;

    auditService = {
      logSuccess: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProxyCacheJobService,
        { provide: ProxyCacheService, useValue: proxyCacheService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<ProxyCacheJobService>(ProxyCacheJobService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  describe('startJobProcessor', () => {
    it('should perform cleanup job if available', async () => {
      // Mock a pending job
      mockQueryRunner.query.mockResolvedValueOnce([
        { id: 1, type: 'proxy-cache-cleanup', status: 'pending' },
      ]); // Select
      mockQueryRunner.query.mockResolvedValueOnce(undefined); // Update status

      proxyCacheService.executeProxyCacheCleanup.mockResolvedValue({
        total: 5,
        byRepo: { repo1: 5 },
      });

      // Start processor
      await service.startJobProcessor();

      // Fast-forward time to trigger interval
      jest.advanceTimersByTime(30001);

      // Wait for promises to resolve (many ticks for sequential awaits)
      for (let i = 0; i < 20; i++) await Promise.resolve();

      // Verify
      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      // It selects the job
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM jobs'),
        expect.anything(),
      );
      // It updates job to running
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE jobs SET status'),
        ['running', 1],
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();

      // It executes cleanup
      expect(proxyCacheService.executeProxyCacheCleanup).toHaveBeenCalled();

      // It updates job to completed
      expect(mockJobRepo.update).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ status: 'completed' }),
      );

      // It logs audit
      expect(auditService.logSuccess).toHaveBeenCalled();
    });

    it('should skip if no job found', async () => {
      // Mock no jobs
      mockQueryRunner.query.mockResolvedValueOnce([]);

      await service.startJobProcessor();
      jest.advanceTimersByTime(30001);
      for (let i = 0; i < 20; i++) await Promise.resolve();

      expect(mockQueryRunner.connect).toHaveBeenCalled();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(proxyCacheService.executeProxyCacheCleanup).not.toHaveBeenCalled();
    });
  });

  describe('startProxyCacheCleanupScheduler', () => {
    it('should try to lock and create job if leader', async () => {
      // Mock lock success
      mockQueryRunner.query.mockResolvedValueOnce([{ locked: true }]);
      // Mock existing job check (none)
      mockJobRepo.findOne.mockResolvedValue(null);

      await service.startProxyCacheCleanupScheduler();

      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_try_advisory_lock'),
        expect.anything(),
      );
      expect(mockJobRepo.findOne).toHaveBeenCalled();
      expect(mockJobRepo.save).toHaveBeenCalled();
      expect(mockQueryRunner.query).toHaveBeenCalledWith(
        expect.stringContaining('pg_advisory_unlock'),
        expect.anything(),
      );
    });

    it('should not create job if not leader', async () => {
      // Mock lock failure
      mockQueryRunner.query.mockResolvedValueOnce([{ locked: false }]);

      await service.startProxyCacheCleanupScheduler();

      expect(mockJobRepo.save).not.toHaveBeenCalled();
    });
  });
});
