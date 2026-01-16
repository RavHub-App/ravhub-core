import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RepositoryPermissionService } from '../repos/repository-permission.service';
import { ReposService } from '../repos/repos.service';

/**
 * Guard to check repository-level permissions
 * Verifies if the authenticated user has the required permission for a specific repository
 */
@Injectable()
export class RepositoryPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private repoPermissionService: RepositoryPermissionService,
    private reposService: ReposService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permission from decorator
    const requiredPermission = this.reflector.get<
      'read' | 'write' | 'admin' | null
    >('repositoryPermission', context.getHandler());

    // If no permission required, allow access
    if (!requiredPermission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // User must be authenticated
    if (!user || !user.id) {
      throw new UnauthorizedException('Authentication required');
    }

    // Extract repository ID from request
    // Can be in params as 'id', 'repoId', or 'name'
    const repositoryId =
      request.params?.id ||
      request.params?.repoId ||
      request.params?.repositoryId;

    let repoId = repositoryId;

    // If we got a name instead of ID, resolve it using findOne (handles both UUID and name)
    if (repositoryId && !repositoryId.match(/^[0-9a-f-]{36}$/i)) {
      try {
        const repo = await this.reposService.findOne(repositoryId);
        if (repo) {
          repoId = repo.id;
        }
      } catch (err) {
        // If repo not found, let it fail later in the actual endpoint
        return true;
      }
    }

    if (!repoId) {
      // No repository context, can't check permissions
      return true;
    }

    // Check if user has global permissions (superadmin, admin, etc.)
    const hasGlobalPermission = this.checkGlobalPermissions(
      user,
      requiredPermission,
    );
    if (hasGlobalPermission) {
      return true;
    }

    // Check repository-specific permissions
    const hasRepoPermission = await this.repoPermissionService.hasPermission(
      user.id,
      repoId,
      requiredPermission,
    );

    if (!hasRepoPermission) {
      throw new ForbiddenException(
        `You don't have ${requiredPermission} permission for this repository`,
      );
    }

    return true;
  }

  /**
   * Check if user has global permissions that override repository permissions
   */
  private checkGlobalPermissions(
    user: any,
    requiredPermission: 'read' | 'write' | 'admin',
  ): boolean {
    const permissions = user.permissions || [];
    const roles = user.roles || [];

    // Superadmin or wildcard permission
    if (
      permissions.includes('*') ||
      roles.includes('superadmin') ||
      roles.includes('admin')
    ) {
      return true;
    }

    // Check for specific global permissions
    const permissionMap = {
      read: 'repo.read',
      write: 'repo.write',
      admin: 'repo.manage',
    };

    return permissions.includes(permissionMap[requiredPermission]);
  }
}
