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

import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import jwt from 'jsonwebtoken';
import * as bcrypt from 'bcryptjs';

import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { User } from '../../entities/user.entity';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private users: UsersService,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
  ) { }

  private authCache: Map<string, { result: any; expires: number }> = new Map();

  async validateUser(username: string, password: string) {
    const key = username + ':' + password;
    const cached = this.authCache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    const u = await this.users.findByUsername(username);
    if (!u || !u.passwordhash) return null;
    const ok = await bcrypt.compare(password, u.passwordhash);
    if (!ok) return null;
    // return basic user profile
    const result = { id: u.id, username: u.username };

    // Cache success for 60 seconds to avoid CPU burn on Basic Auth loops
    this.authCache.set(key, { result, expires: Date.now() + 60000 });
    return result;
  }

  signToken(payload: any): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET must be set in environment variables');
    }
    // 1h token by default
    return jwt.sign(
      payload,
      secret as jwt.Secret,
      { expiresIn: process.env.JWT_EXPIRES_IN || '1h' } as jwt.SignOptions,
    );
  }

  signRefreshToken(payload: any): string {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error('JWT_SECRET must be set in environment variables');
    }
    // 7d refresh token by default
    return jwt.sign(
      payload,
      secret as jwt.Secret,
      {
        expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
      } as jwt.SignOptions,
    );
  }

  async updateRefreshToken(userId: string, refreshToken: string) {
    const hash = await bcrypt.hash(refreshToken, 10);
    await this.users.update(userId, { refreshTokenHash: hash });
  }

  async validateRefreshToken(userId: string, refreshToken: string) {
    const user = await this.userRepo.createQueryBuilder('user')
      .where('user.id = :id', { id: userId })
      .addSelect('user.refreshTokenHash')
      .getOne();

    if (!user || !user.refreshTokenHash) return null;

    const isMatch = await bcrypt.compare(refreshToken, user.refreshTokenHash);
    if (!isMatch) return null;

    return user;
  }

  verifyToken(token: string) {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        this.logger.error('JWT_SECRET not configured');
        return null;
      }
      return jwt.verify(token, secret as jwt.Secret);
    } catch (err) {
      this.logger.debug('JWT verify failed: ' + err.message);
      return null;
    }
  }
}
