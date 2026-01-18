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

import { PermissionService } from 'src/modules/rbac/permission.service';
import { User } from 'src/entities/user.entity';
import { RepositoryPermission } from 'src/entities/repository-permission.entity';
import { Repository } from 'typeorm';

describe('PermissionService (Unit)', () => {
  let service: PermissionService;
  let userRepo: jest.Mocked<Repository<User>>;
  let repoPermRepo: jest.Mocked<Repository<RepositoryPermission>>;

  beforeEach(() => {
    userRepo = {
      findOne: jest.fn(),
    } as any;
    repoPermRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;
    service = new PermissionService(userRepo, repoPermRepo);
  });

  describe('checkPermission', () => {
    it('should return false for non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.checkPermission('u1', 'repo.read');
      expect(result.granted).toBe(false);
      expect(result.level).toBe('none');
    });

    it('should grant superadmin access', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'superadmin', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.checkPermission('u1', 'repo.read');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('superadmin');
    });

    it('should grant admin access', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'admin', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.checkPermission('u1', 'repo.write');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('superadmin');
    });

    it('should grant access with wildcard permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'custom', permissions: [{ key: '*' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.checkPermission('u1', 'any.permission');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('superadmin');
    });

    it('should grant global permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'developer', permissions: [{ key: 'repo.read' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.checkPermission('u1', 'repo.read');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('global');
      expect(result.permission).toBe('repo.read');
    });

    it('should grant repo.read with repo.manage permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'developer', permissions: [{ key: 'repo.manage' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.checkPermission('u1', 'repo.read');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('global');
    });

    it('should check repository-specific permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ id: 'r1', name: 'viewer', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);
      repoPermRepo.find.mockResolvedValue([
        { repositoryId: 'repo1', userId: 'u1', permission: 'read' },
      ] as any);

      const result = await service.checkPermission('u1', 'repo.read', 'repo1');
      expect(result.granted).toBe(true);
      expect(result.level).toBe('repository');
    });

    it('should deny if no permission found', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'viewer', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);
      repoPermRepo.find.mockResolvedValue([]);

      const result = await service.checkPermission('u1', 'repo.manage');
      expect(result.granted).toBe(false);
      expect(result.level).toBe('none');
    });
  });

  describe('hasPermission', () => {
    it('should return boolean result', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'admin', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.hasPermission('u1', 'repo.read');
      expect(result).toBe(true);
    });
  });

  describe('getUserRepositoryPermission', () => {
    it('should return null for non-existent user', async () => {
      userRepo.findOne.mockResolvedValue(null);
      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBeNull();
    });

    it('should return admin for superadmin', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'superadmin', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBe('admin');
    });

    it('should return admin for repo.manage permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'manager', permissions: [{ key: 'repo.manage' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBe('admin');
    });

    it('should return write for repo.write permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'developer', permissions: [{ key: 'repo.write' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBe('write');
    });

    it('should return highest repository-specific permission', async () => {
      const user = {
        id: 'u1',
        roles: [{ id: 'r1', name: 'viewer', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const mockQB: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest
          .fn()
          .mockResolvedValue([{ permission: 'read' }, { permission: 'write' }]),
      };
      repoPermRepo.createQueryBuilder.mockReturnValue(mockQB);

      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBe('write');
    });

    it('should return null if no permissions found', async () => {
      const user = {
        id: 'u1',
        roles: [{ id: 'r1', name: 'viewer', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const mockQB: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      };
      repoPermRepo.createQueryBuilder.mockReturnValue(mockQB);

      const result = await service.getUserRepositoryPermission('u1', 'repo1');
      expect(result).toBeNull();
    });
  });

  describe('Permission hierarchy', () => {
    it('should respect repo permission hierarchy (manage > write > read)', async () => {
      const user = {
        id: 'u1',
        roles: [{ name: 'developer', permissions: [{ key: 'repo.write' }] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);

      const readResult = await service.checkPermission('u1', 'repo.read');
      expect(readResult.granted).toBe(true);

      const writeResult = await service.checkPermission('u1', 'repo.write');
      expect(writeResult.granted).toBe(true);

      const manageResult = await service.checkPermission('u1', 'repo.manage');
      expect(manageResult.granted).toBe(false);
    });

    it('should check role-based repository permissions', async () => {
      const user = {
        id: 'u1',
        roles: [{ id: 'role1', name: 'viewer', permissions: [] }],
      } as any;
      userRepo.findOne.mockResolvedValue(user);
      repoPermRepo.find.mockResolvedValue([]);

      const mockQB: any = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([{ permission: 'admin' }]),
      };
      repoPermRepo.createQueryBuilder.mockReturnValue(mockQB);

      const result = await service.checkPermission(
        'u1',
        'repo.manage',
        'repo1',
      );
      expect(result.granted).toBe(true);
      expect(result.level).toBe('repository');
    });
  });
});
