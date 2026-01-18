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
import { RbacService } from 'src/modules/rbac/rbac.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Role } from 'src/entities/role.entity';
import { Permission } from 'src/entities/permission.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { NotFoundException } from '@nestjs/common';

describe('RbacService', () => {
    let service: RbacService;
    let roleRepo: any;
    let permRepo: any;
    let auditService: any;

    beforeEach(async () => {
        roleRepo = {
            find: jest.fn(),
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
        };

        permRepo = {
            find: jest.fn(),
        };

        auditService = {
            logSuccess: jest.fn().mockResolvedValue(undefined),
        };

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                RbacService,
                {
                    provide: getRepositoryToken(Role),
                    useValue: roleRepo,
                },
                {
                    provide: getRepositoryToken(Permission),
                    useValue: permRepo,
                },
                {
                    provide: AuditService,
                    useValue: auditService,
                },
            ],
        }).compile();

        service = module.get<RbacService>(RbacService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('getRoles', () => {
        it('should return all roles with permissions', async () => {
            const roles = [
                { id: '1', name: 'admin', permissions: [] },
                { id: '2', name: 'user', permissions: [] },
            ];
            roleRepo.find.mockResolvedValue(roles);

            const result = await service.getRoles();

            expect(result).toEqual(roles);
            expect(roleRepo.find).toHaveBeenCalledWith({ relations: ['permissions'] });
        });
    });

    describe('getRole', () => {
        it('should return a specific role', async () => {
            const role = { id: '1', name: 'admin', permissions: [] };
            roleRepo.findOne.mockResolvedValue(role);

            const result = await service.getRole('1');

            expect(result).toEqual(role);
            expect(roleRepo.findOne).toHaveBeenCalledWith({
                where: { id: '1' },
                relations: ['permissions'],
            });
        });

        it('should throw NotFoundException if role not found', async () => {
            roleRepo.findOne.mockResolvedValue(null);

            await expect(service.getRole('999')).rejects.toThrow(NotFoundException);
        });
    });

    describe('createRole', () => {
        it('should create a role without permissions', async () => {
            const roleData = { name: 'moderator', description: 'Moderator role' };
            const createdRole = { id: '3', ...roleData, permissions: [] };

            roleRepo.create.mockReturnValue(createdRole);
            roleRepo.save.mockResolvedValue(createdRole);

            const result = await service.createRole(roleData);

            expect(result).toEqual(createdRole);
            expect(roleRepo.create).toHaveBeenCalledWith({
                name: 'moderator',
                description: 'Moderator role',
            });
            expect(roleRepo.save).toHaveBeenCalled();
            expect(auditService.logSuccess).toHaveBeenCalledWith({
                action: 'role.create',
                entityType: 'role',
                entityId: '3',
                details: { name: 'moderator', permissions: undefined },
            });
        });

        it('should create a role with permissions', async () => {
            const permissions = [
                { id: '1', key: 'repo.read' },
                { id: '2', key: 'repo.write' },
            ];
            const roleData = {
                name: 'editor',
                permissions: ['repo.read', 'repo.write'],
            };
            const createdRole = { id: '4', name: 'editor', permissions };

            roleRepo.create.mockReturnValue({ id: '4', name: 'editor' });
            permRepo.find.mockResolvedValue(permissions);
            roleRepo.save.mockResolvedValue(createdRole);

            const result = await service.createRole(roleData);

            expect(result).toEqual(createdRole);
            expect(permRepo.find).toHaveBeenCalled();
        });

        it('should handle audit logging failure gracefully', async () => {
            const roleData = { name: 'test' };
            const createdRole = { id: '5', name: 'test' };

            roleRepo.create.mockReturnValue(createdRole);
            roleRepo.save.mockResolvedValue(createdRole);
            auditService.logSuccess.mockRejectedValue(new Error('Audit failed'));

            const result = await service.createRole(roleData);

            expect(result).toEqual(createdRole);
        });
    });

    describe('updateRole', () => {
        it('should update role name and description', async () => {
            const existingRole = { id: '1', name: 'admin', permissions: [] };
            const updateData = { name: 'super-admin', description: 'Super admin' };
            const updatedRole = { ...existingRole, ...updateData };

            roleRepo.findOne.mockResolvedValue(existingRole);
            roleRepo.save.mockResolvedValue(updatedRole);

            const result = await service.updateRole('1', updateData);

            expect(result).toEqual(updatedRole);
            expect(roleRepo.save).toHaveBeenCalled();
        });

        it('should update role permissions', async () => {
            const existingRole = { id: '1', name: 'admin', permissions: [] };
            const permissions = [{ id: '1', key: 'repo.read' }];
            const updateData = { permissions: ['repo.read'] };

            roleRepo.findOne.mockResolvedValue(existingRole);
            permRepo.find.mockResolvedValue(permissions);
            roleRepo.save.mockResolvedValue({ ...existingRole, permissions });

            const result = await service.updateRole('1', updateData);

            expect(result.permissions).toEqual(permissions);
        });

        it('should clear permissions when empty array provided', async () => {
            const existingRole = {
                id: '1',
                name: 'admin',
                permissions: [{ id: '1', key: 'repo.read' }],
            };
            const updateData = { permissions: [] };

            roleRepo.findOne.mockResolvedValue(existingRole);
            roleRepo.save.mockResolvedValue({ ...existingRole, permissions: [] });

            const result = await service.updateRole('1', updateData);

            expect(result.permissions).toEqual([]);
        });

        it('should throw NotFoundException if role not found', async () => {
            roleRepo.findOne.mockResolvedValue(null);

            await expect(service.updateRole('999', { name: 'test' })).rejects.toThrow(
                NotFoundException,
            );
        });
    });

    describe('deleteRole', () => {
        it('should delete a role', async () => {
            const role = { id: '1', name: 'admin', permissions: [] };
            roleRepo.findOne.mockResolvedValue(role);
            roleRepo.remove.mockResolvedValue(role);

            const result = await service.deleteRole('1');

            expect(result).toEqual({ ok: true });
            expect(roleRepo.remove).toHaveBeenCalledWith(role);
            expect(auditService.logSuccess).toHaveBeenCalledWith({
                action: 'role.delete',
                entityType: 'role',
                entityId: '1',
                details: { name: 'admin' },
            });
        });

        it('should throw NotFoundException if role not found', async () => {
            roleRepo.findOne.mockResolvedValue(null);

            await expect(service.deleteRole('999')).rejects.toThrow(NotFoundException);
        });
    });

    describe('getPermissions', () => {
        it('should return all permissions', async () => {
            const permissions = [
                { id: '1', key: 'repo.read', description: 'Read repositories' },
                { id: '2', key: 'repo.write', description: 'Write repositories' },
            ];
            permRepo.find.mockResolvedValue(permissions);

            const result = await service.getPermissions();

            expect(result).toEqual(permissions);
            expect(permRepo.find).toHaveBeenCalled();
        });
    });
});
