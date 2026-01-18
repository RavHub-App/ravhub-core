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

import { CleanupService } from 'src/modules/cleanup/cleanup.service';
import { CleanupPolicy } from 'src/entities/cleanup-policy.entity';
import { Artifact } from 'src/entities/artifact.entity';
import { JobService } from 'src/modules/jobs/job.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { RedlockService } from 'src/modules/redis/redlock.service';
import { Repository } from 'typeorm';
import { NotFoundException } from '@nestjs/common';

describe('CleanupService (Unit)', () => {
  let service: CleanupService;
  let policyRepo: jest.Mocked<Repository<CleanupPolicy>>;
  let artifactRepo: jest.Mocked<Repository<Artifact>>;
  let jobService: jest.Mocked<JobService>;
  let storageService: jest.Mocked<StorageService>;
  let auditService: jest.Mocked<AuditService>;
  let redlockService: jest.Mocked<RedlockService>;

  beforeEach(() => {
    policyRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;
    artifactRepo = {
      delete: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;
    jobService = {
      createJob: jest.fn(),
      acquireJob: jest.fn(),
      completeJob: jest.fn(),
      failJob: jest.fn(),
    } as any;
    storageService = {
      delete: jest.fn(),
    } as any;
    auditService = {
      logSuccess: jest.fn().mockResolvedValue({}), // Return resolved promise to allow .catch()
    } as any;
    redlockService = {
      runWithLock: jest.fn((key, ttl, fn) => fn()),
    } as any;

    service = new CleanupService(
      policyRepo,
      artifactRepo,
      jobService,
      storageService,
      auditService,
      redlockService,
    );
  });

  describe('findOne', () => {
    it('should return policy if found', async () => {
      const policy = { id: '1', name: 'test' };
      policyRepo.findOne.mockResolvedValue(policy as any);
      const result = await service.findOne('1');
      expect(result).toEqual(policy);
    });

    it('should throw NotFoundException if not found', async () => {
      policyRepo.findOne.mockResolvedValue(null);
      await expect(service.findOne('1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('cleanupArtifacts (via execute)', () => {
    const policy: Partial<CleanupPolicy> = {
      id: 'p1',
      name: 'Policy 1',
      target: 'artifacts',
      strategy: 'age-based',
      maxAgeDays: 30,
      enabled: true,
      frequency: 'daily',
      scheduleTime: '02:00',
    };

    it('should delete items based on age-based strategy', async () => {
      const oldArtifact = {
        id: 'a1',
        createdAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000),
        size: 100,
        storageKey: 'k1',
      };
      const newArtifact = {
        id: 'a2',
        createdAt: new Date(),
        size: 50,
        storageKey: 'k2',
      };

      policyRepo.findOne.mockResolvedValue(policy as any);

      const mockQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([oldArtifact, newArtifact]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.execute('p1');

      expect(result.deleted).toBe(1);
      expect(storageService.delete).toHaveBeenCalledWith('k1');
      expect(artifactRepo.delete).toHaveBeenCalledWith('a1');
    });

    it('should delete items based on count-based strategy', async () => {
      const pCount: any = { ...policy, strategy: 'count-based', maxCount: 1 };
      const a1 = {
        id: 'a1',
        createdAt: new Date(Date.now() - 1000),
        size: 10,
        repository: { name: 'r1' },
      };
      const a2 = {
        id: 'a2',
        createdAt: new Date(),
        size: 10,
        repository: { name: 'r1' },
      }; // newer

      policyRepo.findOne.mockResolvedValue(pCount);
      const mockQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([a1, a2]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.execute('p1');

      expect(result.deleted).toBe(1);
      expect(artifactRepo.delete).toHaveBeenCalledWith('a1'); // Deleted the older one
    });

    it('should delete items based on size-based strategy', async () => {
      const pSize: any = {
        ...policy,
        strategy: 'size-based',
        maxSizeBytes: 100,
      };
      const a1 = { id: 'a1', createdAt: new Date(Date.now() - 2000), size: 60 };
      const a2 = { id: 'a2', createdAt: new Date(Date.now() - 1000), size: 60 };
      const a3 = { id: 'a3', createdAt: new Date(), size: 60 };

      policyRepo.findOne.mockResolvedValue(pSize);
      const mockQueryBuilder: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([a1, a2, a3]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.execute('p1');

      expect(result.deleted).toBe(2);
      expect(artifactRepo.delete).toHaveBeenCalledWith('a1');
      expect(artifactRepo.delete).toHaveBeenCalledWith('a2');
    });
  });

  describe('calculateNextRun', () => {
    it('should calculate next run for daily frequency', () => {
      const next = (service as any).calculateNextRun('daily', '02:00');
      expect(next.getHours()).toBe(2);
      expect(next.getMinutes()).toBe(0);
      expect(next.getTime()).toBeGreaterThan(Date.now());
    });

    it('should calculate next run for weekly frequency', () => {
      const next = (service as any).calculateNextRun('weekly', '03:00');
      expect(next.getHours()).toBe(3);
    });
  });

  describe('CRUD operations', () => {
    it('should find all policies', async () => {
      policyRepo.find.mockResolvedValue([{ id: 'p1' }] as any);
      const res = await service.findAll();
      expect(res).toHaveLength(1);
    });

    it('should create a policy', async () => {
      policyRepo.create.mockImplementation((d) => d as any);
      policyRepo.save.mockResolvedValue({ id: 'p1' } as any);
      const res = await service.create({
        name: 'test',
        target: 'artifacts',
        strategy: 'age-based',
      });
      expect(res.id).toBe('p1');
      expect(policyRepo.save).toHaveBeenCalled();
    });

    it('should update a policy', async () => {
      policyRepo.findOne.mockResolvedValue({
        id: 'p1',
        frequency: 'daily',
        scheduleTime: '02:00',
      } as any);
      policyRepo.update.mockResolvedValue({ affected: 1 } as any);
      await service.update('p1', { name: 'updated' });
      expect(policyRepo.update).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({ name: 'updated' }),
      );
    });

    it('should delete a policy', async () => {
      await service.delete('p1');
      expect(policyRepo.delete).toHaveBeenCalledWith('p1');
    });
  });

  describe('Job processing', () => {
    it('should create jobs for pending policies', async () => {
      const mockQB: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'p1',
            name: 'test',
            frequency: 'daily',
            scheduleTime: '02:00',
          },
        ]),
      };
      policyRepo.createQueryBuilder.mockReturnValue(mockQB);

      await service.createJobsForPendingPolicies();
      expect(jobService.createJob).toHaveBeenCalledWith(
        'cleanup',
        expect.objectContaining({ policyId: 'p1' }),
      );
    });

    it('should process cleanup jobs', async () => {
      jobService.acquireJob.mockResolvedValue({
        id: 'j1',
        payload: { policyId: 'p1', policyName: 'test' },
      } as any);
      policyRepo.findOne.mockResolvedValue({
        id: 'p1',
        target: 'artifacts',
        strategy: 'age-based',
        frequency: 'daily',
        scheduleTime: '02:00',
      } as any);
      const mockQB: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQB);

      await service.processCleanupJobs();
      expect(jobService.completeJob).toHaveBeenCalledWith(
        'j1',
        expect.objectContaining({ deleted: 0 }),
      );
    });

    it('should return early if no job is available', async () => {
      jobService.acquireJob.mockResolvedValue(null);
      await service.processCleanupJobs();
      expect(jobService.completeJob).not.toHaveBeenCalled();
    });
  });

  describe('Docker blob cleanup', () => {
    it('should skip docker-blobs cleanup', async () => {
      const policy: any = {
        id: 'p1',
        name: 'docker',
        target: 'docker-blobs',
        frequency: 'daily',
        scheduleTime: '02:00',
      };
      policyRepo.findOne.mockResolvedValue(policy);

      const res = await service.execute('p1');
      expect(res.deleted).toBe(0);
      expect(res.freedBytes).toBe(0);
    });
  });

  describe('Artifact filtering', () => {
    it('should filter artifacts by keepTagPattern', async () => {
      const policy: any = {
        id: 'p1',
        target: 'artifacts',
        strategy: 'age-based',
        maxAgeDays: 1,
        keepTagPattern: 'v*',
        frequency: 'daily',
        scheduleTime: '02:00',
      };
      const a1 = {
        id: 'a1',
        version: 'v1.0',
        createdAt: new Date(0),
        size: 10,
      };
      const a2 = { id: 'a2', version: 'dev', createdAt: new Date(0), size: 10 };

      policyRepo.findOne.mockResolvedValue(policy);
      const mockQB: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([a1, a2]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQB);

      const res = await service.execute('p1');
      expect(res.deleted).toBe(1);
      expect(artifactRepo.delete).toHaveBeenCalledWith('a2');
    });

    it('should filter artifacts by repositoryIds', async () => {
      const policy: any = {
        id: 'p1',
        target: 'artifacts',
        strategy: 'age-based',
        maxAgeDays: 1,
        repositoryIds: ['r1'],
        frequency: 'daily',
        scheduleTime: '02:00',
      };
      policyRepo.findOne.mockResolvedValue(policy);
      const mockQB: any = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      artifactRepo.createQueryBuilder.mockReturnValue(mockQB);

      await service.execute('p1');
      expect(mockQB.where).toHaveBeenCalledWith(
        'artifact.repositoryId IN (:...repoIds)',
        { repoIds: ['r1'] },
      );
    });
  });
});
