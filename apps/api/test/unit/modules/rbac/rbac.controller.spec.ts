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
import { RbacController } from 'src/modules/rbac/rbac.controller';
import { RbacService } from 'src/modules/rbac/rbac.service';

describe('RbacController', () => {
    let controller: RbacController;
    let service: RbacService;

    const mockRbacService = {
        getRoles: jest.fn(),
        getRole: jest.fn(),
        createRole: jest.fn(),
        updateRole: jest.fn(),
        deleteRole: jest.fn(),
        getPermissions: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [RbacController],
            providers: [
                {
                    provide: RbacService,
                    useValue: mockRbacService,
                },
            ],
        })
            .overrideGuard(require('src/modules/rbac/permissions.guard').PermissionsGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<RbacController>(RbacController);
        service = module.get<RbacService>(RbacService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('listRoles', () => {
        it('should return all roles', async () => {
            const roles = [
                { id: '1', name: 'admin', permissions: [] },
                { id: '2', name: 'user', permissions: [] },
            ];
            mockRbacService.getRoles.mockResolvedValue(roles);

            const result = await controller.listRoles();

            expect(result).toEqual(roles);
            expect(service.getRoles).toHaveBeenCalled();
        });
    });

    describe('getRole', () => {
        it('should return a specific role', async () => {
            const role = { id: '1', name: 'admin', permissions: [] };
            mockRbacService.getRole.mockResolvedValue(role);

            const result = await controller.getRole('1');

            expect(result).toEqual(role);
            expect(service.getRole).toHaveBeenCalledWith('1');
        });
    });

    describe('createRole', () => {
        it('should create a new role', async () => {
            const roleData = { name: 'moderator', description: 'Moderator role' };
            const createdRole = { id: '3', ...roleData, permissions: [] };
            mockRbacService.createRole.mockResolvedValue(createdRole);

            const result = await controller.createRole(roleData);

            expect(result).toEqual(createdRole);
            expect(service.createRole).toHaveBeenCalledWith(roleData);
        });

        it('should create role with permissions', async () => {
            const roleData = {
                name: 'editor',
                permissions: ['repo.read', 'repo.write'],
            };
            const createdRole = { id: '4', ...roleData };
            mockRbacService.createRole.mockResolvedValue(createdRole);

            const result = await controller.createRole(roleData);

            expect(result).toEqual(createdRole);
            expect(service.createRole).toHaveBeenCalledWith(roleData);
        });
    });

    describe('updateRole', () => {
        it('should update a role', async () => {
            const updateData = { name: 'super-admin' };
            const updatedRole = { id: '1', ...updateData, permissions: [] };
            mockRbacService.updateRole.mockResolvedValue(updatedRole);

            const result = await controller.updateRole('1', updateData);

            expect(result).toEqual(updatedRole);
            expect(service.updateRole).toHaveBeenCalledWith('1', updateData);
        });

        it('should update role permissions', async () => {
            const updateData = { permissions: ['repo.read'] };
            const updatedRole = { id: '1', name: 'admin', ...updateData };
            mockRbacService.updateRole.mockResolvedValue(updatedRole);

            const result = await controller.updateRole('1', updateData);

            expect(result).toEqual(updatedRole);
            expect(service.updateRole).toHaveBeenCalledWith('1', updateData);
        });
    });

    describe('deleteRole', () => {
        it('should delete a role', async () => {
            mockRbacService.deleteRole.mockResolvedValue({ ok: true });

            const result = await controller.deleteRole('1');

            expect(result).toEqual({ ok: true });
            expect(service.deleteRole).toHaveBeenCalledWith('1');
        });
    });

    describe('listPermissions', () => {
        it('should return all permissions', async () => {
            const permissions = [
                { id: '1', key: 'repo.read', description: 'Read repositories' },
                { id: '2', key: 'repo.write', description: 'Write repositories' },
            ];
            mockRbacService.getPermissions.mockResolvedValue(permissions);

            const result = await controller.listPermissions();

            expect(result).toEqual(permissions);
            expect(service.getPermissions).toHaveBeenCalled();
        });
    });
});
