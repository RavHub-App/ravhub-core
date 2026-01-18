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

import { JobService } from 'src/modules/jobs/job.service';
import { Job } from 'src/entities/job.entity';
import { Repository } from 'typeorm';

describe('JobService (Unit)', () => {
  let service: JobService;
  let repo: jest.Mocked<Repository<Job>>;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'j1', ...d })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn(),
      manager: {
        connection: {
          createQueryRunner: jest.fn(),
        },
      },
    } as any;
    service = new JobService(repo);
    // Prevent interval from starting in tests
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create a job', async () => {
    const res = await service.createJob('cleanup', { foo: 'bar' });
    expect(res.type).toBe('cleanup');
    expect(res.status).toBe('pending');
    expect(repo.save).toHaveBeenCalled();
  });

  it('should complete a job', async () => {
    await service.completeJob('j1', { ok: true });
    expect(repo.update).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        status: 'completed',
        result: { ok: true },
      }),
    );
  });

  it('should fail a job and retry if attempts < max', async () => {
    repo.findOne.mockResolvedValue({
      id: 'j1',
      attempts: 1,
      maxAttempts: 3,
    } as any);
    await service.failJob('j1', 'error message');
    expect(repo.update).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        status: 'pending',
        error: 'error message',
      }),
    );
  });

  it('should fail a job permanently if max attempts reached', async () => {
    repo.findOne.mockResolvedValue({
      id: 'j1',
      attempts: 3,
      maxAttempts: 3,
    } as any);
    await service.failJob('j1', 'final error');
    expect(repo.update).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({
        status: 'failed',
        error: 'final error',
      }),
    );
  });

  it('should cleanup old jobs', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ affected: 10 });
    const mockQB: any = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: mockExecute,
    };
    repo.createQueryBuilder.mockReturnValue(mockQB);

    const affected = await service.cleanupOldJobs(7);
    expect(affected).toBe(10);
  });

  it('should acquire a job', async () => {
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'j1' }]) // First query: select job
        .mockResolvedValueOnce({ affected: 1 }), // Second query: update job
      connection: { createQueryRunner: jest.fn() },
    };
    (repo.manager.connection.createQueryRunner as jest.Mock).mockReturnValue(
      mockQueryRunner,
    );
    repo.findOne.mockResolvedValue({ id: 'j1', status: 'running' } as any);

    const job = await service.acquireJob('cleanup');
    expect(job).toBeDefined();
    expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
  });

  it('should return null if no job to acquire', async () => {
    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      query: jest.fn().mockResolvedValue([]),
      connection: { createQueryRunner: jest.fn() },
    };
    (repo.manager.connection.createQueryRunner as jest.Mock).mockReturnValue(
      mockQueryRunner,
    );

    const job = await service.acquireJob();
    expect(job).toBeNull();
    expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
  });

  it('should refresh job lock', async () => {
    const mockQB: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    repo.createQueryBuilder.mockReturnValue(mockQB);

    const res = await service.refreshJobLock('j1');
    expect(res).toBeTruthy();
  });

  it('should release stale locks', async () => {
    const mockQB: any = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 3 }),
    };
    repo.createQueryBuilder.mockReturnValue(mockQB);

    const released = await service.releaseStaleLocks();
    expect(released).toBe(3);
  });
});
