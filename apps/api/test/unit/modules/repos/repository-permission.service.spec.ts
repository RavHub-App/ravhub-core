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
import { RepositoryPermissionService } from 'src/modules/repos/repository-permission.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RepositoryPermission } from 'src/entities/repository-permission.entity';

describe('RepositoryPermissionService', () => {
    let service: RepositoryPermissionService;
    let repo: any;
    let mockManager: any;
    let mockUserRepo: any;
    let mockQueryBuilder: any;

    beforeEach(async () => {
        mockQueryBuilder = {
            where: jest.fn().mockReturnThis(),
            andWhere: jest.fn().mockReturnThis(),
            leftJoinAndSelect: jest.fn().mockReturnThis(),
            getMany: jest.fn(),
        };

        mockUserRepo = {
            findOne: jest.fn(),
        };

        mockManager = {
            getRepository: jest.fn().mockReturnValue(mockUserRepo),
        };

        repo = {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
            manager: mockManager,
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RepositoryPermissionService,
                {
                    provide: getRepositoryToken(RepositoryPermission),
                    useValue: repo,
                },
            ],
        }).compile();

        service = module.get<RepositoryPermissionService>(RepositoryPermissionService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getRepositoryPermissions', () => {
        it('should return all permissions for a repository', async () => {
            const permissions = [
                { id: '1', repositoryId: 'r1', userId: 'u1', permission: 'read' },
                { id: '2', repositoryId: 'r1', roleId: 'role1', permission: 'write' },
            ];
            repo.find.mockResolvedValue(permissions);

            const result = await service.getRepositoryPermissions('r1');

            expect(result).toEqual(permissions);
            expect(repo.find).toHaveBeenCalledWith({
                where: { repositoryId: 'r1' },
                relations: ['user', 'role'],
            });
        });
    });

    describe('grantUserPermission', () => {
        it('should create new user permission', async () => {
            const newPerm = { id: '1', repositoryId: 'r1', userId: 'u1', permission: 'read' };
            repo.findOne.mockResolvedValue(null);
            repo.create.mockReturnValue(newPerm);
            repo.save.mockResolvedValue(newPerm);

            const result = await service.grantUserPermission('r1', 'u1', 'read');

            expect(result).toEqual(newPerm);
            expect(repo.create).toHaveBeenCalledWith({
                repositoryId: 'r1',
                userId: 'u1',
                permission: 'read',
            });
        });

        it('should return existing permission if already exists', async () => {
            const existingPerm = { id: '1', repositoryId: 'r1', userId: 'u1', permission: 'read' };
            repo.findOne.mockResolvedValue(existingPerm);

            const result = await service.grantUserPermission('r1', 'u1', 'read');

            expect(result).toEqual(existingPerm);
            expect(repo.save).not.toHaveBeenCalled();
        });

        it('should grant write permission', async () => {
            const newPerm = { id: '2', repositoryId: 'r1', userId: 'u1', permission: 'write' };
            repo.findOne.mockResolvedValue(null);
            repo.create.mockReturnValue(newPerm);
            repo.save.mockResolvedValue(newPerm);

            const result = await service.grantUserPermission('r1', 'u1', 'write');

            expect(result.permission).toBe('write');
        });

        it('should grant admin permission', async () => {
            const newPerm = { id: '3', repositoryId: 'r1', userId: 'u1', permission: 'admin' };
            repo.findOne.mockResolvedValue(null);
            repo.create.mockReturnValue(newPerm);
            repo.save.mockResolvedValue(newPerm);

            const result = await service.grantUserPermission('r1', 'u1', 'admin');

            expect(result.permission).toBe('admin');
        });
    });

    describe('grantRolePermission', () => {
        it('should create new role permission', async () => {
            const newPerm = { id: '1', repositoryId: 'r1', roleId: 'role1', permission: 'read' };
            repo.findOne.mockResolvedValue(null);
            repo.create.mockReturnValue(newPerm);
            repo.save.mockResolvedValue(newPerm);

            const result = await service.grantRolePermission('r1', 'role1', 'read');

            expect(result).toEqual(newPerm);
            expect(repo.create).toHaveBeenCalledWith({
                repositoryId: 'r1',
                roleId: 'role1',
                permission: 'read',
            });
        });

        it('should return existing role permission if already exists', async () => {
            const existingPerm = { id: '1', repositoryId: 'r1', roleId: 'role1', permission: 'write' };
            repo.findOne.mockResolvedValue(existingPerm);

            const result = await service.grantRolePermission('r1', 'role1', 'write');

            expect(result).toEqual(existingPerm);
            expect(repo.save).not.toHaveBeenCalled();
        });
    });

    describe('revokePermission', () => {
        it('should delete a permission', async () => {
            repo.delete.mockResolvedValue({ affected: 1 });

            const result = await service.revokePermission('perm1');

            expect(result).toEqual({ ok: true });
            expect(repo.delete).toHaveBeenCalledWith('perm1');
        });
    });

    describe('hasPermission', () => {
        it('should return false if user not found', async () => {
            mockUserRepo.findOne.mockResolvedValue(null);

            const result = await service.hasPermission('u1', 'r1', 'read');

            expect(result).toBe(false);
        });

        it('should return true for direct user permission', async () => {
            const user = { id: 'u1', roles: [] };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([{ permission: 'read' }]);

            const result = await service.hasPermission('u1', 'r1', 'read');

            expect(result).toBe(true);
        });

        it('should return true when user has higher permission level', async () => {
            const user = { id: 'u1', roles: [] };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([{ permission: 'admin' }]);

            const result = await service.hasPermission('u1', 'r1', 'read');

            expect(result).toBe(true);
        });

        it('should return false when user has lower permission level', async () => {
            const user = { id: 'u1', roles: [] };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([{ permission: 'read' }]);

            const result = await service.hasPermission('u1', 'r1', 'admin');

            expect(result).toBe(false);
        });

        it('should check role-based permissions', async () => {
            const user = { id: 'u1', roles: [{ id: 'role1' }] };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([]);
            mockQueryBuilder.getMany.mockResolvedValue([{ permission: 'write' }]);

            const result = await service.hasPermission('u1', 'r1', 'write');

            expect(result).toBe(true);
            expect(mockQueryBuilder.where).toHaveBeenCalled();
            expect(mockQueryBuilder.andWhere).toHaveBeenCalled();
        });

        it('should return false when no permissions found', async () => {
            const user = { id: 'u1', roles: [] };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([]);

            const result = await service.hasPermission('u1', 'r1', 'read');

            expect(result).toBe(false);
        });

        it('should handle user with no roles', async () => {
            const user = { id: 'u1', roles: null };
            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([]);

            const result = await service.hasPermission('u1', 'r1', 'read');

            expect(result).toBe(false);
        });
    });

    describe('getUserRepositories', () => {
        it('should return empty array if user not found', async () => {
            mockUserRepo.findOne.mockResolvedValue(null);

            const result = await service.getUserRepositories('u1');

            expect(result).toEqual([]);
        });

        it('should return repositories from direct user permissions', async () => {
            const user = { id: 'u1', roles: [] };
            const userPerms = [
                { repositoryId: 'r1', permission: 'read', repository: { id: 'r1', name: 'repo1' } },
            ];

            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue(userPerms);

            const result = await service.getUserRepositories('u1');

            expect(result).toHaveLength(1);
            expect(result[0].repository.id).toBe('r1');
            expect(result[0].permission).toBe('read');
        });

        it('should return repositories from role permissions', async () => {
            const user = { id: 'u1', roles: [{ id: 'role1' }] };
            const rolePerms = [
                { repositoryId: 'r2', permission: 'write', repository: { id: 'r2', name: 'repo2' } },
            ];

            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue([]);
            mockQueryBuilder.getMany.mockResolvedValue(rolePerms);

            const result = await service.getUserRepositories('u1');

            expect(result).toHaveLength(1);
            expect(result[0].repository.id).toBe('r2');
        });

        it('should deduplicate and use highest permission level', async () => {
            const user = { id: 'u1', roles: [{ id: 'role1' }] };
            const userPerms = [
                { repositoryId: 'r1', permission: 'read', repository: { id: 'r1', name: 'repo1' } },
            ];
            const rolePerms = [
                { repositoryId: 'r1', permission: 'admin', repository: { id: 'r1', name: 'repo1' } },
            ];

            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue(userPerms);
            mockQueryBuilder.getMany.mockResolvedValue(rolePerms);

            const result = await service.getUserRepositories('u1');

            expect(result).toHaveLength(1);
            expect(result[0].permission).toBe('admin');
        });

        it('should skip permissions without repository', async () => {
            const user = { id: 'u1', roles: [] };
            const userPerms = [{ repositoryId: 'r1', permission: 'read', repository: null }];

            mockUserRepo.findOne.mockResolvedValue(user);
            repo.find.mockResolvedValue(userPerms);

            const result = await service.getUserRepositories('u1');

            expect(result).toEqual([]);
        });
    });
});
