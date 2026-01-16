import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { RepositoryPermission } from '../../entities/repository-permission.entity';

export interface PermissionCheckResult {
  granted: boolean;
  level: 'superadmin' | 'global' | 'repository' | 'none';
  permission?: string;
}

/**
 * Unified Permission Service
 *
 * Centralizes all permission checking logic following the hierarchical model:
 * 1. Superadmin/Admin → Full access
 * 2. Global permissions → Access to all repositories
 * 3. Repository permissions → Access to specific repositories
 */
@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(RepositoryPermission)
    private readonly repoPermRepo: Repository<RepositoryPermission>,
  ) {}

  /**
   * Check if user has permission with detailed result
   *
   * @param userId - User ID
   * @param requiredPermission - Required permission (e.g., 'repo.read', 'user.manage')
   * @param repositoryId - Optional repository ID for repository-specific checks
   * @returns Detailed permission check result
   */
  async checkPermission(
    userId: string,
    requiredPermission: string,
    repositoryId?: string,
  ): Promise<PermissionCheckResult> {
    // Load user with roles and permissions
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) {
      return { granted: false, level: 'none' };
    }

    // Extract permissions and roles
    const permissions = this.extractUserPermissions(user);
    const roles = user.roles?.map((r) => r.name) || [];

    // LEVEL 1: Superadmin/Admin check
    if (
      permissions.includes('*') ||
      roles.includes('superadmin') ||
      roles.includes('admin')
    ) {
      return { granted: true, level: 'superadmin', permission: '*' };
    }

    // LEVEL 2: Global permission check
    if (permissions.includes(requiredPermission)) {
      return { granted: true, level: 'global', permission: requiredPermission };
    }

    // For repository operations, check global repo.* permissions
    if (requiredPermission.startsWith('repo.')) {
      const globalRepoPermission = this.getGlobalRepoPermission(permissions);
      if (
        globalRepoPermission &&
        this.satisfiesRepoPermission(requiredPermission, globalRepoPermission)
      ) {
        return {
          granted: true,
          level: 'global',
          permission: globalRepoPermission,
        };
      }
    }

    // LEVEL 3: Repository-specific permission check
    if (repositoryId && requiredPermission.startsWith('repo.')) {
      const repoPermLevel = this.mapGlobalToRepoPermission(requiredPermission);
      if (repoPermLevel) {
        const hasRepoPermission = await this.hasRepositoryPermission(
          userId,
          repositoryId,
          repoPermLevel,
        );

        if (hasRepoPermission) {
          return {
            granted: true,
            level: 'repository',
            permission: repoPermLevel,
          };
        }
      }
    }

    // No permission found
    return { granted: false, level: 'none' };
  }

  /**
   * Simple boolean check for permission
   */
  async hasPermission(
    userId: string,
    requiredPermission: string,
    repositoryId?: string,
  ): Promise<boolean> {
    const result = await this.checkPermission(
      userId,
      requiredPermission,
      repositoryId,
    );
    return result.granted;
  }

  /**
   * Check repository-specific permission
   */
  private async hasRepositoryPermission(
    userId: string,
    repositoryId: string,
    requiredLevel: 'read' | 'write' | 'admin',
  ): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles'],
    });

    if (!user) return false;

    const permissionLevels = { read: 1, write: 2, admin: 3 };
    const requiredLevelValue = permissionLevels[requiredLevel];

    // Check direct user permissions
    const userPerms = await this.repoPermRepo.find({
      where: { repositoryId, userId },
    });

    for (const perm of userPerms) {
      if (permissionLevels[perm.permission] >= requiredLevelValue) {
        return true;
      }
    }

    // Check role-based permissions
    const roleIds = user.roles?.map((r) => r.id) || [];
    if (roleIds.length > 0) {
      const rolePerms = await this.repoPermRepo
        .createQueryBuilder('perm')
        .where('perm.repositoryId = :repositoryId', { repositoryId })
        .andWhere('perm.roleId IN (:...roleIds)', { roleIds })
        .getMany();

      for (const perm of rolePerms) {
        if (permissionLevels[perm.permission] >= requiredLevelValue) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract all permissions from user's roles
   */
  private extractUserPermissions(user: User): string[] {
    const permissions = new Set<string>();

    if (user.roles) {
      for (const role of user.roles) {
        if (role.permissions) {
          for (const perm of role.permissions) {
            permissions.add(perm.key);
          }
        }
      }
    }

    return Array.from(permissions);
  }

  /**
   * Get the highest global repo permission user has
   */
  private getGlobalRepoPermission(permissions: string[]): string | null {
    if (permissions.includes('repo.manage')) return 'repo.manage';
    if (permissions.includes('repo.write')) return 'repo.write';
    if (permissions.includes('repo.read')) return 'repo.read';
    return null;
  }

  /**
   * Check if a global permission satisfies the requirement
   */
  private satisfiesRepoPermission(required: string, has: string): boolean {
    const hierarchy = ['repo.read', 'repo.write', 'repo.manage'];
    const requiredIndex = hierarchy.indexOf(required);
    const hasIndex = hierarchy.indexOf(has);

    return hasIndex >= requiredIndex && requiredIndex >= 0;
  }

  /**
   * Map global permission to repository permission level
   */
  private mapGlobalToRepoPermission(
    globalPerm: string,
  ): 'read' | 'write' | 'admin' | null {
    const mapping: Record<string, 'read' | 'write' | 'admin'> = {
      'repo.read': 'read',
      'repo.write': 'write',
      'repo.manage': 'admin',
    };
    return mapping[globalPerm] || null;
  }

  /**
   * Get user's permission level for a specific repository
   * Returns the highest permission level the user has
   */
  async getUserRepositoryPermission(
    userId: string,
    repositoryId: string,
  ): Promise<'read' | 'write' | 'admin' | null> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      relations: ['roles', 'roles.permissions'],
    });

    if (!user) return null;

    // Check for superadmin/admin
    const permissions = this.extractUserPermissions(user);
    const roles = user.roles?.map((r) => r.name) || [];

    if (
      permissions.includes('*') ||
      roles.includes('superadmin') ||
      roles.includes('admin')
    ) {
      return 'admin';
    }

    // Check global repo permissions
    if (permissions.includes('repo.manage')) return 'admin';
    if (permissions.includes('repo.write')) return 'write';
    if (permissions.includes('repo.read')) return 'read';

    // Check repository-specific permissions
    const roleIds = user.roles?.map((r) => r.id) || [];

    const perms = await this.repoPermRepo
      .createQueryBuilder('perm')
      .where('perm.repositoryId = :repositoryId', { repositoryId })
      .andWhere('(perm.userId = :userId OR perm.roleId IN (:...roleIds))', {
        userId,
        roleIds: roleIds.length > 0 ? roleIds : [''],
      })
      .getMany();

    if (perms.length === 0) return null;

    // Return highest permission level
    const levels = { read: 1, write: 2, admin: 3 };
    let highest = 0;
    let highestPerm: 'read' | 'write' | 'admin' | null = null;

    for (const perm of perms) {
      const level = levels[perm.permission];
      if (level > highest) {
        highest = level;
        highestPerm = perm.permission;
      }
    }

    return highestPerm;
  }
}
