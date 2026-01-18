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

import { AuthController } from 'src/modules/auth/auth.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { UsersService } from 'src/modules/users/users.service';
import { AuditService } from 'src/modules/audit/audit.service';
import { Repository } from 'typeorm';
import { Role } from 'src/entities/role.entity';
import { User } from 'src/entities/user.entity';
import { HttpException, HttpStatus } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

jest.mock('bcryptjs');

describe('AuthController (Unit)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<AuthService>;
  let usersService: jest.Mocked<UsersService>;
  let auditService: jest.Mocked<AuditService>;
  let roleRepo: jest.Mocked<Repository<Role>>;
  let userRepo: jest.Mocked<Repository<User>>;

  beforeEach(() => {
    authService = {
      signToken: jest.fn(),
      signRefreshToken: jest.fn(),
      updateRefreshToken: jest.fn(),
      verifyToken: jest.fn(),
      validateRefreshToken: jest.fn(),
    } as any;
    usersService = {
      findByUsername: jest.fn(),
      findAll: jest.fn(),
      create: jest.fn(),
    } as any;
    auditService = {
      logFailure: jest.fn(),
      logSuccess: jest.fn(),
    } as any;
    roleRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      manager: {
        getRepository: jest.fn(),
      },
    } as any;
    userRepo = {
      findOne: jest.fn(),
    } as any;

    controller = new AuthController(
      authService,
      usersService,
      auditService,
      roleRepo,
      userRepo,
    );
  });

  const mockReq = (overrides = {}) => ({
    ip: '127.0.0.1',
    headers: {
      'user-agent': 'jest-test',
    },
    ...overrides,
  });

  describe('me', () => {
    it('should return 404 if user ID missing', async () => {
      const res = await controller.me(mockReq({ user: null, headers: {} }));
      expect(res.ok).toBeFalsy();
    });

    it('should return user with roles and permissions', async () => {
      userRepo.findOne.mockResolvedValue({
        id: '1',
        username: 'admin',
        roles: [
          {
            name: 'admin',
            permissions: [{ key: 'repo.create' }],
          },
        ],
      } as any);

      const res = await controller.me(mockReq({ user: { id: '1' } }));
      expect(res.ok).toBeTruthy();
      expect(res.user.username).toBe('admin');
      expect(res.user.permissions).toContain('*');
    });
  });

  describe('login', () => {
    it('should throw error if missing credentials', async () => {
      await expect(
        controller.login({ username: '', password: '' }, mockReq()),
      ).rejects.toThrow(HttpException);
    });

    it('should throw 401 if user not found', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      await expect(
        controller.login({ username: 'u', password: 'p' }, mockReq()),
      ).rejects.toThrow(HttpException);
      expect(auditService.logFailure).toHaveBeenCalled();
    });

    it('should return tokens on success', async () => {
      const mockUser = { id: '1', username: 'u', passwordhash: 'hashed' };
      usersService.findByUsername.mockResolvedValue(mockUser as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      authService.signToken.mockReturnValue('at');
      authService.signRefreshToken.mockReturnValue('rt');

      const res = await controller.login(
        { username: 'u', password: 'p' },
        mockReq(),
      );

      expect(res.ok).toBeTruthy();
      expect(res.token).toBe('at');
      expect(auditService.logSuccess).toHaveBeenCalled();
    });
  });

  describe('signup', () => {
    it('should create user and return tokens', async () => {
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
      usersService.create.mockResolvedValue({
        id: '1',
        username: 'new',
      } as any);
      authService.signToken.mockReturnValue('at');
      authService.signRefreshToken.mockReturnValue('rt');

      const res = await controller.signup(
        { username: 'new', password: 'pw' },
        mockReq(),
      );
      expect(res.ok).toBeTruthy();
      expect(res.user.username).toBe('new');
    });
  });

  describe('refresh', () => {
    it('should refresh token', async () => {
      authService.verifyToken.mockReturnValue({ sub: '1' } as any);
      authService.validateRefreshToken.mockResolvedValue({
        id: '1',
        username: 'u',
      } as any);
      authService.signToken.mockReturnValue('at-new');
      authService.signRefreshToken.mockReturnValue('rt-new');

      const res = await controller.refresh({ refreshToken: 'rt-old' });
      expect(res.ok).toBeTruthy();
      expect(res.token).toBe('at-new');
    });

    it('should throw if refresh token invalid', async () => {
      authService.verifyToken.mockReturnValue(null);
      await expect(controller.refresh({ refreshToken: 'bad' })).rejects.toThrow(
        HttpException,
      );
    });
  });

  describe('bootstrap', () => {
    it('should allow bootstrap if no users exist', async () => {
      usersService.findAll.mockResolvedValue([]);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hash');
      usersService.create.mockResolvedValue({
        id: '1',
        username: 'admin',
      } as any);

      // Mock role creation
      const mockRole = { id: 'r1', name: 'superadmin' };
      roleRepo.findOne.mockResolvedValue(null);
      roleRepo.create.mockReturnValue(mockRole as any);
      roleRepo.save.mockResolvedValue(mockRole as any);

      const res = await controller.bootstrap({ password: 'p' });
      expect(res.ok).toBeTruthy();
      expect(res.user.username).toBe('admin');
    });

    it('should forbid bootstrap if users exist', async () => {
      usersService.findAll.mockResolvedValue([{ id: '1' }] as any);
      await expect(controller.bootstrap({ password: 'p' })).rejects.toThrow(
        HttpException,
      );
    });
  });
});
