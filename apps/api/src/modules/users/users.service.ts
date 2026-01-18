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

import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuditService } from '../audit/audit.service';
import { LicenseService } from '../license/license.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private repo: Repository<User>,
    private readonly auditService: AuditService,
    private readonly licenseService: LicenseService,
  ) {}

  async findAll() {
    return await this.repo.find({ relations: ['roles', 'roles.permissions'] });
  }

  async findOne(id: string) {
    return await this.repo.findOne({
      where: { id },
      relations: ['roles', 'roles.permissions'],
    });
  }

  async findByUsername(username: string) {
    return await this.repo.findOne({
      where: { username },
      relations: ['roles', 'roles.permissions'],
    });
  }

  async create(data: Partial<User>): Promise<User> {
    const u = this.repo.create(data as any) as unknown as User;
    const saved = await this.repo.save(u as any);

    await this.auditService
      .logSuccess({
        action: 'user.create',
        entityType: 'user',
        entityId: saved.id,
        details: { username: saved.username },
      })
      .catch(() => {});

    return this.findOne(saved.id) as Promise<User>;
  }

  async update(id: string, data: Partial<User>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async delete(id: string): Promise<void> {
    const user = await this.findOne(id);
    await this.repo.delete(id);

    if (user) {
      await this.auditService
        .logSuccess({
          action: 'user.delete',
          entityType: 'user',
          entityId: id,
          details: { username: user.username },
        })
        .catch(() => {});
    }
  }
}
