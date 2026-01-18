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

import {
  Controller,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Get,
  Req,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcryptjs';
import AppDataSource from '../../data-source';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private users: UsersService,
    private audit: AuditService,
    @InjectRepository(Role) private roleRepo?: Repository<Role>,
    @InjectRepository(User) private userRepo?: Repository<User>,
  ) {}

  // Return the authenticated user (if any) along with roles/permissions when available
  @Get('me')
  async me(@Req() req: any) {
    const id = req.user?.id || req.headers['x-user-id'];
    if (!id) return { ok: false, user: null };

    try {
      if (this.userRepo) {
        const u = await this.userRepo.findOne({
          where: { id },
          relations: ['roles', 'roles.permissions'],
        });
        if (!u) return { ok: false, message: 'not found' };

        const perms = new Set<string>();
        (u.roles || []).forEach((r: any) => {
          (r.permissions || []).forEach((p: any) => perms.add(p.key));
          if (r.name === 'admin' || r.name === 'superadmin') perms.add('*');
        });

        return {
          ok: true,
          user: {
            id: u.id,
            username: u.username,
            roles: (u.roles || []).map((r) => r.name),
            permissions: Array.from(perms),
          },
        };
      }
    } catch (err) {
      // fallthrough
    }

    return { ok: false, message: 'db unavailable' };
  }

  @Get('bootstrap-status')
  async bootstrapStatus() {
    try {
      const existingUsers = await this.users.findAll();
      const total = Array.isArray(existingUsers) ? existingUsers.length : 0;
      return {
        ok: true,
        bootstrapRequired: total === 0,
      };
    } catch (err) {
      return { ok: false, message: 'db unavailable' };
    }
  }

  @Post('login')
  async login(
    @Body() body: { username: string; password: string },
    @Req() req: any,
  ) {
    if (!body?.username || !body?.password)
      throw new HttpException('missing credentials', HttpStatus.BAD_REQUEST);
    const u = await this.users.findByUsername(body.username);
    if (!u || !u.passwordhash) {
      await this.audit.logFailure({
        action: 'auth.login',
        details: { username: body.username },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        error: 'User not found',
      });
      throw new HttpException('invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    const ok = await bcrypt.compare(body.password, u.passwordhash);
    if (!ok) {
      await this.audit.logFailure({
        userId: u.id,
        action: 'auth.login',
        details: { username: body.username },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        error: 'Invalid password',
      });
      throw new HttpException('invalid credentials', HttpStatus.UNAUTHORIZED);
    }
    const token = this.auth.signToken({ sub: u.id, username: u.username });
    const refreshToken = this.auth.signRefreshToken({
      sub: u.id,
      username: u.username,
    });
    await this.auth.updateRefreshToken(u.id, refreshToken);

    await this.audit.logSuccess({
      userId: u.id,
      action: 'auth.login',
      details: { username: body.username },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      ok: true,
      token,
      refreshToken,
      user: { id: u.id, username: u.username },
    };
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken: string }) {
    if (!body.refreshToken)
      throw new HttpException('Refresh token required', HttpStatus.BAD_REQUEST);

    const payload = this.auth.verifyToken(body.refreshToken);
    if (!payload)
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);

    const user = await this.auth.validateRefreshToken(
      payload.sub as string,
      body.refreshToken,
    );
    if (!user)
      throw new HttpException('Invalid refresh token', HttpStatus.UNAUTHORIZED);

    const token = this.auth.signToken({
      sub: user.id,
      username: user.username,
    });
    const refreshToken = this.auth.signRefreshToken({
      sub: user.id,
      username: user.username,
    });
    await this.auth.updateRefreshToken(user.id, refreshToken);

    return {
      ok: true,
      token,
      refreshToken,
      user: { id: user.id, username: user.username },
    };
  }

  @Post('signup')
  async signup(
    @Body() body: { username: string; password: string },
    @Req() req: any,
  ) {
    if (!body?.username || !body?.password)
      throw new HttpException('missing data', HttpStatus.BAD_REQUEST);
    const pwHash = await bcrypt.hash(body.password, 10);
    const created = await this.users.create({
      username: body.username,
      passwordhash: pwHash,
    });
    const token = this.auth.signToken({
      sub: created.id,
      username: created.username,
    });
    const refreshToken = this.auth.signRefreshToken({
      sub: created.id,
      username: created.username,
    });
    await this.auth.updateRefreshToken(created.id, refreshToken);

    await this.audit.logSuccess({
      userId: created.id,
      action: 'auth.signup',
      details: { username: body.username },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      ok: true,
      token,
      refreshToken,
      user: { id: created.id, username: created.username },
    };
  }

  // Bootstrap endpoint to create first admin user with a password.
  // Allowed only if there are no users in the system. Creates an admin role
  // (if not present) and assigns it to the created account.
  @Post('bootstrap')
  async bootstrap(@Body() body: { username?: string; password: string }) {
    if (!body?.password) {
      throw new HttpException('password is required', HttpStatus.BAD_REQUEST);
    }

    // Prefer using the injected UsersService (it uses the TypeORM repository managed
    // by Nest). This avoids relying on the exported AppDataSource instance which
    // can be uninitialized in some dev flows (watch mode). The UsersService repo
    // will function as long as Nest has initialized the TypeOrmModule.
    const existingUsers = await this.users.findAll();
    const total = Array.isArray(existingUsers) ? existingUsers.length : 0;
    if (total > 0)
      throw new HttpException('bootstrap not allowed', HttpStatus.FORBIDDEN);

    const username = body?.username || 'admin';

    // Hash the password
    const passwordhash = await bcrypt.hash(body.password, 10);

    // ensure superadmin (preferred) or admin role exists and has all permissions when possible
    // Use injected role repository when possible (safer than relying on AppDataSource).
    let adminRole: Role | null = null;
    let activeRoleRepo: Repository<Role> | null = null;

    if (this.roleRepo) {
      activeRoleRepo = this.roleRepo;
    } else if (AppDataSource.isInitialized) {
      try {
        activeRoleRepo = AppDataSource.getRepository(Role) as any;
      } catch (e) {
        activeRoleRepo = null;
      }
    }

    if (activeRoleRepo) {
      // prefer existing superadmin, then admin
      try {
        adminRole = await activeRoleRepo.findOne({
          where: { name: 'superadmin' },
          relations: ['permissions'],
        });
        if (!adminRole) {
          adminRole = await activeRoleRepo.findOne({
            where: { name: 'admin' },
            relations: ['permissions'],
          });
        }
      } catch (e) {
        // ignore and fall through to create
      }

      if (!adminRole) {
        adminRole = activeRoleRepo.create({
          name: 'superadmin',
          description: 'Super administrator - full access',
        } as Partial<Role>);
        // attempt to attach all permissions if permission repository is available
        try {
          const permRepo = activeRoleRepo.manager.getRepository(
            Permission as any,
          );
          const all = await permRepo.find();
          (adminRole as any).permissions = all;
        } catch (e) {
          // ignore; we'll still create the role without permissions
        }
        await activeRoleRepo.save(adminRole as any);
      }
    }

    // create user with hashed password and assign admin role if available
    const userData: Partial<User> = { username, passwordhash };
    if (adminRole) userData.roles = [adminRole];
    const saved = await this.users.create(userData as any);

    const token = this.auth.signToken({
      sub: saved.id,
      username: saved.username,
    });
    const refreshToken = this.auth.signRefreshToken({
      sub: saved.id,
      username: saved.username,
    });
    await this.auth.updateRefreshToken(saved.id, refreshToken);

    return {
      ok: true,
      token,
      refreshToken,
      user: { id: saved.id, username: saved.username },
    };
  }
}
