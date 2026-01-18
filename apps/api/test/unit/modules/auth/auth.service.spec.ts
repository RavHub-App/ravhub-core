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

import { AuthService } from 'src/modules/auth/auth.service';
import { UsersService } from 'src/modules/users/users.service';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

jest.mock('bcryptjs');
jest.mock('jsonwebtoken');

describe('AuthService (Unit)', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;

  beforeEach(() => {
    usersService = {
      findByUsername: jest.fn(),
      update: jest.fn(),
      findOne: jest.fn(),
    } as any;
    service = new AuthService(usersService);
    process.env.JWT_SECRET = 'test-secret';
    jest.clearAllMocks();
  });

  describe('validateUser', () => {
    it('should return null if user not found', async () => {
      usersService.findByUsername.mockResolvedValue(null);
      const result = await service.validateUser('test', 'pass');
      expect(result).toBeNull();
    });

    it('should return null if password compare fails', async () => {
      usersService.findByUsername.mockResolvedValue({
        id: '1',
        username: 'test',
        passwordhash: 'hash',
      } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const result = await service.validateUser('test', 'pass');
      expect(result).toBeNull();
    });

    it('should return user object and cache result on success', async () => {
      usersService.findByUsername.mockResolvedValue({
        id: '1',
        username: 'test',
        passwordhash: 'hash',
      } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.validateUser('test', 'pass');
      expect(result).toEqual({ id: '1', username: 'test' });

      // Check cache (second call should not call usersService)
      await service.validateUser('test', 'pass');
      expect(usersService.findByUsername).toHaveBeenCalledTimes(1);
    });
  });

  describe('signToken', () => {
    it('should sign a JWT token', () => {
      (jwt.sign as jest.Mock).mockReturnValue('signed-token');
      const result = service.signToken({ sub: '1' });
      expect(result).toBe('signed-token');
      expect(jwt.sign).toHaveBeenCalledWith(
        { sub: '1' },
        'test-secret',
        expect.any(Object),
      );
    });

    it('should throw if JWT_SECRET is missing', () => {
      delete process.env.JWT_SECRET;
      expect(() => service.signToken({})).toThrow('JWT_SECRET must be set');
    });
  });

  describe('verifyToken', () => {
    it('should verify token successfully', () => {
      (jwt.verify as jest.Mock).mockReturnValue({ sub: '1' });
      const result = service.verifyToken('token');
      expect(result).toEqual({ sub: '1' });
    });

    it('should return null if verify fails', () => {
      (jwt.verify as jest.Mock).mockImplementation(() => {
        throw new Error('fail');
      });
      const result = service.verifyToken('token');
      expect(result).toBeNull();
    });
  });

  describe('validateRefreshToken', () => {
    it('should validate refresh token successfully', async () => {
      usersService.findOne.mockResolvedValue({
        id: '1',
        refreshTokenHash: 'hash',
      } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      const result = await service.validateRefreshToken('1', 'token');
      expect(result).toBeDefined();
    });

    it('should return null if token does not match', async () => {
      usersService.findOne.mockResolvedValue({
        id: '1',
        refreshTokenHash: 'hash',
      } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const result = await service.validateRefreshToken('1', 'token');
      expect(result).toBeNull();
    });
  });
});
