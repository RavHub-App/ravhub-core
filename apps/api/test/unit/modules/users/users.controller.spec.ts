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
import { UsersController } from 'src/modules/users/users.controller';
import { UsersService } from 'src/modules/users/users.service';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import AppDataSource from 'src/data-source';

jest.mock('bcryptjs');
jest.mock('src/data-source', () => ({
    __esModule: true,
    default: {
        getRepository: jest.fn(),
    },
}));

describe('UsersController', () => {
    let controller: UsersController;
    let service: UsersService;
    let mockRoleRepo: any;

    const mockUsersService = {
        findAll: jest.fn(),
        findOne: jest.fn(),
        findByUsername: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    beforeEach(async () => {
        mockRoleRepo = {
            findOne: jest.fn(),
        };

        (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRoleRepo);
        (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');

        const module: TestingModule = await Test.createTestingModule({
            controllers: [UsersController],
            providers: [
                {
                    provide: UsersService,
                    useValue: mockUsersService,
                },
            ],
        })
            .overrideGuard(require('src/modules/rbac/permissions.guard').PermissionsGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<UsersController>(UsersController);
        service = module.get<UsersService>(UsersService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('list', () => {
        it('should return all users without password hashes', async () => {
            const users = [
                { id: '1', username: 'user1', passwordhash: 'hash1', displayName: 'User 1' },
                { id: '2', username: 'user2', passwordhash: 'hash2', displayName: 'User 2' },
            ];
            mockUsersService.findAll.mockResolvedValue(users);

            const result = await controller.list();

            expect(result).toHaveLength(2);
            expect(result[0]).not.toHaveProperty('passwordhash');
            expect(result[0]).toHaveProperty('username', 'user1');
            expect(service.findAll).toHaveBeenCalled();
        });
    });

    describe('get', () => {
        it('should return a user without password hash', async () => {
            const user = { id: '1', username: 'user1', passwordhash: 'hash1', displayName: 'User 1' };
            mockUsersService.findOne.mockResolvedValue(user);

            const result = await controller.get('1');

            expect(result).not.toHaveProperty('passwordhash');
            expect(result).toHaveProperty('username', 'user1');
            expect(service.findOne).toHaveBeenCalledWith('1');
        });

        it('should throw 404 if user not found', async () => {
            mockUsersService.findOne.mockResolvedValue(null);

            await expect(controller.get('999')).rejects.toThrow(
                new HttpException('not found', HttpStatus.NOT_FOUND),
            );
        });
    });

    describe('create', () => {
        it('should create a user', async () => {
            const userData = { username: 'newuser', password: 'pass123', displayName: 'New User' };
            const createdUser = { id: '3', username: 'newuser', passwordhash: 'hashed', displayName: 'New User' };

            mockUsersService.findByUsername.mockResolvedValue(null);
            mockUsersService.create.mockResolvedValue(createdUser);

            const result = await controller.create(userData);

            expect(result).not.toHaveProperty('passwordhash');
            expect(result).toHaveProperty('username', 'newuser');
            expect(bcrypt.hash).toHaveBeenCalledWith('pass123', 10);
            expect(service.create).toHaveBeenCalled();
        });

        it('should create user with roles', async () => {
            const userData = { username: 'admin', password: 'pass', roles: ['admin', 'user'] };
            const role1 = { id: '1', name: 'admin' };
            const role2 = { id: '2', name: 'user' };
            const createdUser = { id: '4', username: 'admin', passwordhash: 'hashed', roles: [role1, role2] };

            mockUsersService.findByUsername.mockResolvedValue(null);
            mockRoleRepo.findOne
                .mockResolvedValueOnce(role1)
                .mockResolvedValueOnce(role2);
            mockUsersService.create.mockResolvedValue(createdUser);

            const result = await controller.create(userData);

            expect(result).toHaveProperty('username', 'admin');
            expect(mockRoleRepo.findOne).toHaveBeenCalledTimes(2);
        });

        it('should throw 400 if username missing', async () => {
            await expect(controller.create({ password: 'pass' })).rejects.toThrow(
                new HttpException('missing fields', HttpStatus.BAD_REQUEST),
            );
        });

        it('should throw 400 if password missing', async () => {
            await expect(controller.create({ username: 'user' })).rejects.toThrow(
                new HttpException('missing fields', HttpStatus.BAD_REQUEST),
            );
        });

        it('should throw 409 if username already exists', async () => {
            mockUsersService.findByUsername.mockResolvedValue({ id: '1', username: 'existing' });

            await expect(controller.create({ username: 'existing', password: 'pass' })).rejects.toThrow(
                new HttpException('username taken', HttpStatus.CONFLICT),
            );
        });
    });

    describe('update', () => {
        it('should update user display name', async () => {
            const existingUser = { id: '1', username: 'user1', passwordhash: 'hash' };
            const updatedUser = { ...existingUser, displayName: 'Updated Name' };

            mockUsersService.findOne.mockResolvedValue(existingUser);
            mockUsersService.update.mockResolvedValue(updatedUser);

            const result = await controller.update('1', { displayName: 'Updated Name' });

            expect(result).toHaveProperty('displayName', 'Updated Name');
            expect(result).not.toHaveProperty('passwordhash');
        });

        it('should update user password', async () => {
            const existingUser = { id: '1', username: 'user1', passwordhash: 'oldhash' };
            const updatedUser = { ...existingUser, passwordhash: 'newhash' };

            mockUsersService.findOne.mockResolvedValue(existingUser);
            mockUsersService.update.mockResolvedValue(updatedUser);

            await controller.update('1', { password: 'newpass' });

            expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 10);
        });

        it('should update user roles', async () => {
            const existingUser = { id: '1', username: 'user1', passwordhash: 'hash' };
            const role = { id: '1', name: 'admin' };
            const updatedUser = { ...existingUser, roles: [role] };

            mockUsersService.findOne.mockResolvedValue(existingUser);
            mockRoleRepo.findOne.mockResolvedValue(role);
            mockUsersService.update.mockResolvedValue(updatedUser);

            const result = await controller.update('1', { roles: ['admin'] });

            expect(result).toHaveProperty('username', 'user1');
            expect(mockRoleRepo.findOne).toHaveBeenCalled();
        });

        it('should throw 404 if user not found', async () => {
            mockUsersService.findOne.mockResolvedValue(null);

            await expect(controller.update('999', { displayName: 'Test' })).rejects.toThrow(
                new HttpException('not found', HttpStatus.NOT_FOUND),
            );
        });
    });

    describe('delete', () => {
        it('should delete a user', async () => {
            const req = { user: { id: '1' } };
            mockUsersService.delete.mockResolvedValue(undefined);

            const result = await controller.delete('2', req);

            expect(result).toEqual({ ok: true });
            expect(service.delete).toHaveBeenCalledWith('2');
        });

        it('should prevent self-deletion', async () => {
            const req = { user: { id: '1' } };

            await expect(controller.delete('1', req)).rejects.toThrow(
                new HttpException('Cannot delete your own account', HttpStatus.FORBIDDEN),
            );
        });

        it('should allow deletion when no user in request', async () => {
            const req = {};
            mockUsersService.delete.mockResolvedValue(undefined);

            const result = await controller.delete('2', req);

            expect(result).toEqual({ ok: true });
        });
    });
});
