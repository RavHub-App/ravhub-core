import {
  CanActivate,
  Injectable,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { RepositoryPermissionService } from '../repos/repository-permission.service';
import { ReposService } from '../repos/repos.service';

/**
 * Unified Permission Guard
 *
 * Implements a hierarchical permission system:
 * 1. Superadmin/Admin roles → Full access (wildcard *)
 * 2. Global permissions (repo.read, repo.write, repo.manage) → Access to all repositories
 * 3. Repository-specific permissions → Access to individual repositories
 *
 * Higher levels override lower levels. This allows:
 * - Admins to manage everything
 * - Global permissions for cross-repository operations
 * - Granular control per repository when needed
 */
@Injectable()
export class UnifiedPermissionGuard implements CanActivate {
  private readonly logger = new Logger(UnifiedPermissionGuard.name);

  constructor(
    private reflector: Reflector,
    private repoPermissionService?: RepositoryPermissionService,
    private reposService?: ReposService,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get required permissions from @Permissions() decorator
    const requiredGlobalPermissions = this.reflector.getAllAndOverride<
      string[]
    >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    // Get required repository permission from @RepositoryPermission() decorator
    const requiredRepoPermission = this.reflector.get<
      'read' | 'write' | 'admin' | null
    >('repositoryPermission', context.getHandler());

    // Get required user permission from @UserPermission() decorator
    const requiredUserPermission = this.reflector.get<
      'read' | 'write' | 'admin' | null
    >('userPermission', context.getHandler());

    // If no permissions required, allow access
    if (
      (!requiredGlobalPermissions || requiredGlobalPermissions.length === 0) &&
      !requiredRepoPermission &&
      !requiredUserPermission
    ) {
      return true;
    }

    const req = context.switchToHttp().getRequest();

    // LEVEL 0: Check for public repository access (anonymous allowed)
    if (requiredRepoPermission === 'read' && this.reposService) {
      const repositoryId =
        req.params?.id ||
        req.params?.repoId ||
        req.params?.repositoryId ||
        req.params?.name;

      if (repositoryId) {
        const repo = await this.reposService.findOneCached(repositoryId);
        if (repo) {
          req.repository = repo; // Cache for controller
          if (repo.config?.authEnabled === false) {
            this.logger.debug(
              `UnifiedPermissionGuard: allowing anonymous access to public repository ${repo.name}`,
            );
            return true;
          }
        }
      }
    }

    // Allow unauthenticated GET to /repository for readiness checks
    if (this.isReadinessCheck(req)) {
      //   this.logger.debug(
      //     'UnifiedPermissionGuard: allowing unauthenticated GET /repository for readiness',
      //   );
      return true;
    }

    // User must be authenticated
    if (!req.user || !req.user.id) {
      this.logger.debug('UnifiedPermissionGuard: no authenticated user found');
      throw new UnauthorizedException('Authentication required');
    }

    const user = req.user;
    // this.logger.debug(
    //   `UnifiedPermissionGuard: checking permissions for user ${user.username || user.id}`,
    // );

    // LEVEL 1: Check for Superadmin/Admin role (highest priority)
    if (this.isSuperAdmin(user)) {
      // this.logger.debug(
      //   'UnifiedPermissionGuard: user is superadmin/admin, granting full access',
      // );
      return true;
    }

    // LEVEL 2: Check global permissions
    if (requiredGlobalPermissions && requiredGlobalPermissions.length > 0) {
      const hasGlobal = this.checkGlobalPermissions(
        user,
        requiredGlobalPermissions,
      );
      if (hasGlobal) {
        // this.logger.debug(
        //   `UnifiedPermissionGuard: user has global permission ${requiredGlobalPermissions.join(',')}`,
        // );
        return true;
      }
    }

    // LEVEL 3: Check repository-specific permissions (if applicable)
    if (requiredRepoPermission) {
      const hasRepoPermission = await this.checkRepositoryPermission(
        req,
        user,
        requiredRepoPermission,
      );

      if (hasRepoPermission) {
        // this.logger.debug(
        //   `UnifiedPermissionGuard: user has repository permission ${requiredRepoPermission}`,
        // );
        return true;
      }

      // If we reached here, user lacks the required repository permission
      throw new ForbiddenException(
        `You don't have ${requiredRepoPermission} permission for this repository`,
      );
    }

    // LEVEL 3b: Check user-specific permissions (if applicable)
    if (requiredUserPermission) {
      const hasUserPermission = await this.checkUserPermission(
        req,
        user,
        requiredUserPermission,
      );

      if (hasUserPermission) {
        this.logger.debug(
          `UnifiedPermissionGuard: user has user permission ${requiredUserPermission}`,
        );
        return true;
      }

      // If we reached here, user lacks the required user permission
      throw new ForbiddenException(
        `You don't have ${requiredUserPermission} permission for this user`,
      );
    }

    // If we only checked global permissions and user doesn't have them, deny
    if (requiredGlobalPermissions && requiredGlobalPermissions.length > 0) {
      this.logger.debug(
        `UnifiedPermissionGuard: user lacks required permissions: ${requiredGlobalPermissions.join(',')}`,
      );
      throw new ForbiddenException(
        'Missing required permissions: ' + requiredGlobalPermissions.join(','),
      );
    }

    // Default deny
    return false;
  }

  /**
   * Check if request is a readiness check
   */
  private isReadinessCheck(req: any): boolean {
    try {
      const method = String(req.method).toUpperCase();
      return (
        method === 'GET' &&
        req.url &&
        typeof req.url === 'string' &&
        /(^|\/)repository(\/|$)/.test(req.url)
      );
    } catch {
      return false;
    }
  }

  /**
   * Check if user has superadmin or admin role
   */
  private isSuperAdmin(user: any): boolean {
    const permissions = user.permissions || [];
    const roles = user.roles || [];

    return (
      permissions.includes('*') ||
      roles.includes('superadmin') ||
      roles.includes('admin')
    );
  }

  /**
   * Check if user has required global permissions
   */
  private checkGlobalPermissions(user: any, required: string[]): boolean {
    const userPermissions = user.permissions || [];

    // Check for wildcard
    if (userPermissions.includes('*')) {
      return true;
    }

    // Check each required permission
    for (const need of required) {
      if (userPermissions.includes(need)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check repository-specific permissions
   */
  private async checkRepositoryPermission(
    req: any,
    user: any,
    requiredPermission: 'read' | 'write' | 'admin',
  ): Promise<boolean> {
    // Extract repository ID from request
    const repositoryId =
      req.params?.id ||
      req.params?.repoId ||
      req.params?.repositoryId ||
      req.params?.name;

    if (!repositoryId) {
      // No repository context, can't check repository permissions
      return false;
    }

    let repoId = repositoryId;

    // If we got a name instead of UUID, resolve it
    if (!this.reposService) {
      this.logger.warn(
        'UnifiedPermissionGuard: ReposService not available for name resolution',
      );
      return false;
    }

    if (!repositoryId.match(/^[0-9a-f-]{36}$/i)) {
      try {
        const repo = req.repository || (await this.reposService.findOne(repositoryId));
        if (repo) {
          req.repository = repo; // Cache for controller
          repoId = repo.id;
        } else {
          // Repo not found, let the actual endpoint handle it
          return false;
        }
      } catch (err) {
        this.logger.warn(
          `UnifiedPermissionGuard: Error resolving repository ${repositoryId}:`,
          err,
        );
        return false;
      }
    }

    // Check repository-specific permissions
    if (!this.repoPermissionService) {
      this.logger.warn(
        'UnifiedPermissionGuard: RepositoryPermissionService not available',
      );
      return false;
    }

    return this.repoPermissionService.hasPermission(
      user.id,
      repoId,
      requiredPermission,
    );
  }

  /**
   * Check user-specific permissions
   * For now, this is a simple check - users can view/edit themselves
   * Admins can do everything via global permissions
   */
  private async checkUserPermission(
    req: any,
    user: any,
    requiredPermission: 'read' | 'write' | 'admin',
  ): Promise<boolean> {
    // Extract user ID from request
    const targetUserId = req.params?.id || req.params?.userId;

    if (!targetUserId) {
      // No user context, deny
      return false;
    }

    // Users can always read/write their own profile (but not delete - needs admin)
    if (user.id === targetUserId) {
      if (requiredPermission === 'read' || requiredPermission === 'write') {
        this.logger.debug('UnifiedPermissionGuard: user accessing own profile');
        return true;
      }
      // Cannot self-admin (delete, etc.)
      return false;
    }

    // For other users, deny (must have global permission)
    return false;
  }
}
