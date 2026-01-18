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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RepositoryPermission } from '../../entities/repository-permission.entity';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';

@Injectable()
export class RepositoryPermissionService {
  constructor(
    @InjectRepository(RepositoryPermission)
    private readonly repo: Repository<RepositoryPermission>,
  ) {}

  /**
   * Get all permissions for a repository
   */
  async getRepositoryPermissions(repositoryId: string) {
    return this.repo.find({
      where: { repositoryId },
      relations: ['user', 'role'],
    });
  }

  /**
   * Grant permission to a user for a repository
   */
  async grantUserPermission(
    repositoryId: string,
    userId: string,
    permission: 'read' | 'write' | 'admin',
  ) {
    // Check if permission already exists
    const existing = await this.repo.findOne({
      where: { repositoryId, userId, permission },
    });

    if (existing) return existing;

    const perm = this.repo.create({
      repositoryId,
      userId,
      permission,
    });

    return this.repo.save(perm);
  }

  /**
   * Grant permission to a role for a repository
   */
  async grantRolePermission(
    repositoryId: string,
    roleId: string,
    permission: 'read' | 'write' | 'admin',
  ) {
    // Check if permission already exists
    const existing = await this.repo.findOne({
      where: { repositoryId, roleId, permission },
    });

    if (existing) return existing;

    const perm = this.repo.create({
      repositoryId,
      roleId,
      permission,
    });

    return this.repo.save(perm);
  }

  /**
   * Revoke a specific permission
   */
  async revokePermission(permissionId: string) {
    await this.repo.delete(permissionId);
    return { ok: true };
  }

  /**
   * Check if a user has a specific permission for a repository
   * Checks both direct user permissions and role-based permissions
   */
  async hasPermission(
    userId: string,
    repositoryId: string,
    requiredPermission: 'read' | 'write' | 'admin',
  ): Promise<boolean> {
    // Get user with roles
    const userRepo = this.repo.manager.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) return false;

    // Permission hierarchy: admin > write > read
    const permissionLevels = { read: 1, write: 2, admin: 3 };
    const requiredLevel = permissionLevels[requiredPermission];

    // Check direct user permissions
    const userPerms = await this.repo.find({
      where: { repositoryId, userId },
    });

    for (const perm of userPerms) {
      if (permissionLevels[perm.permission] >= requiredLevel) {
        return true;
      }
    }

    // Check role-based permissions
    const roleIds = user.roles?.map((r) => r.id) || [];
    if (roleIds.length > 0) {
      const rolePerms = await this.repo
        .createQueryBuilder('perm')
        .where('perm.repositoryId = :repositoryId', { repositoryId })
        .andWhere('perm.roleId IN (:...roleIds)', { roleIds })
        .getMany();

      for (const perm of rolePerms) {
        if (permissionLevels[perm.permission] >= requiredLevel) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get all repositories a user has access to with their permission level
   */
  async getUserRepositories(userId: string) {
    const userRepo = this.repo.manager.getRepository(User);
    const user = await userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) return [];

    const roleIds = user.roles?.map((r) => r.id) || [];

    // Get direct user permissions
    const userPerms = await this.repo.find({
      where: { userId },
      relations: ['repository'],
    });

    // Get role-based permissions
    let rolePerms: RepositoryPermission[] = [];
    if (roleIds.length > 0) {
      rolePerms = await this.repo
        .createQueryBuilder('perm')
        .leftJoinAndSelect('perm.repository', 'repository')
        .where('perm.roleId IN (:...roleIds)', { roleIds })
        .getMany();
    }

    // Combine and deduplicate
    const repoMap = new Map<string, any>();

    for (const perm of [...userPerms, ...rolePerms]) {
      if (!perm.repository) continue;

      const existing = repoMap.get(perm.repositoryId);
      const permLevel = { read: 1, write: 2, admin: 3 }[perm.permission];

      if (
        !existing ||
        permLevel > ({ read: 1, write: 2, admin: 3 }[existing.permission] || 0)
      ) {
        repoMap.set(perm.repositoryId, {
          repository: perm.repository,
          permission: perm.permission,
        });
      }
    }

    return Array.from(repoMap.values());
  }
}
