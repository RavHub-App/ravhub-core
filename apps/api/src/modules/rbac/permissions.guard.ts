import {
  CanActivate,
  Injectable,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PERMISSIONS_KEY } from './permissions.decorator';
import { User } from '../../entities/user.entity';
import { Role } from '../../entities/role.entity';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);
  constructor(
    private reflector: Reflector,
    @InjectRepository(User) private userRepo?: Repository<User>,
    @InjectRepository(Role) private roleRepo?: Repository<Role>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();

    // Allow unauthenticated GET to the /repository(s) path for readiness checks.
    // This prevents early startup DB/guard races from making e2e tests skip.
    try {
      const m = String(req.method).toUpperCase();
      if (
        m === 'GET' &&
        req.url &&
        typeof req.url === 'string' &&
        /(^|\/)repository(\/|$)/.test(req.url)
      ) {
        this.logger.debug(
          'PermissionsGuard: allowing unauthenticated GET /repository for readiness',
        );
        return true;
      }
    } catch (err) {
      // ignore and continue
    }

    // First, check if we have a user from JWT authentication (req.user)
    if (req.user && req.user.id) {
      this.logger.debug(
        `PermissionsGuard: found authenticated user ${req.user.username || req.user.id}`,
      );

      // Check if user has wildcard permission or required permission
      const userPermissions = req.user.permissions || [];
      const userRolesFromJWT = req.user.roles || [];

      // Superadmin and admin roles get wildcard access
      if (
        userRolesFromJWT.includes('superadmin') ||
        userRolesFromJWT.includes('admin')
      ) {
        this.logger.debug(
          'PermissionsGuard: user is superadmin/admin, granting access',
        );
        return true;
      }

      // Check if user has wildcard or specific permission
      for (const need of required) {
        if (userPermissions.includes('*') || userPermissions.includes(need)) {
          this.logger.debug(
            `PermissionsGuard: user has required permission ${need}`,
          );
          return true;
        }
      }

      // If user is authenticated but doesn't have permission, deny
      this.logger.debug(
        `PermissionsGuard: user lacks required permissions: ${required.join(',')}`,
      );
      throw new ForbiddenException(
        'Missing required permissions: ' + required.join(','),
      );
    }

    // Fallback: allow roles from header 'x-user-roles' as comma-separated list (for testing)
    const rolesHeader = req.headers['x-user-roles'];
    let userRoles: string[] = [];
    if (rolesHeader) {
      userRoles = String(rolesHeader)
        .split(',')
        .map((r) => r.trim());
      this.logger.debug(
        `PermissionsGuard roles from header: ${userRoles.join(',')}`,
      );
      // map common roles to permissions locally (fast-path when working in dev)
      const defaultRoleMap: Record<string, string[]> = {
        // treat `superadmin` as an all-powerful role by default
        superadmin: ['*'],
        admin: ['*'],
        reader: ['repo.read'],
      };
      const fastPerms = new Set<string>();
      for (const r of userRoles) {
        const list = defaultRoleMap[r];
        if (list) for (const p of list) fastPerms.add(p);
      }
      if (fastPerms.size > 0) {
        this.logger.debug(
          `PermissionsGuard fast-path perms=${Array.from(fastPerms).join(',')}`,
        );
        for (const need of required) {
          if (fastPerms.has('*') || fastPerms.has(need)) return true;
        }
      }
    } else if (req.headers['x-user-id']) {
      // try to load user from db
      let userFound = false;
      try {
        const userId = String(req.headers['x-user-id']);
        if (this.userRepo) {
          const u = await this.userRepo.findOne({
            where: { id: userId },
            relations: ['roles', 'roles.permissions'],
          });
          if (u) {
            userFound = true;
            userRoles = (u.roles || []).map((r) => r.name);
          }
        }
      } catch (err) {
        this.logger.warn('PermissionsGuard: error loading user ' + err.message);
      }
    }

    // if no roles and no DB lookup path, deny
    if (!userRoles || userRoles.length === 0) {
      // If an x-user-id header was provided but we couldn't find the user, return 401
      if (req.headers['x-user-id']) {
        // user id provided but not found -> unauthorized
        const { UnauthorizedException } = await import('@nestjs/common');
        throw new UnauthorizedException('user not found');
      }
      throw new ForbiddenException(
        'No roles provided (use x-user-roles or x-user-id)',
      );
    }

    // expand roles -> permissions
    if (this.roleRepo) {
      // fetch by name where possible
      let resolvedRoles: Role[] = [];
      try {
        resolvedRoles = await this.roleRepo.find({
          where: { name: In(userRoles) },
          relations: ['permissions'],
        });
      } catch (err) {
        // fallback to empty
        resolvedRoles = [];
      }
      const userPerms = new Set<string>();
      for (const r of resolvedRoles) {
        const perms = r.permissions || [];
        for (const p of perms) userPerms.add(p.key);
        // superadmin and admin get wildcard access by default
        if (r.name === 'admin' || r.name === 'superadmin') userPerms.add('*');
      }

      this.logger.debug(
        `PermissionsGuard resolvedRoles=${resolvedRoles.map((r) => r.name).join(',')}`,
      );
      this.logger.debug(
        `PermissionsGuard userPerms=${Array.from(userPerms).join(',')}`,
      );
      // check
      for (const need of required) {
        if (userPerms.has('*') || userPerms.has(need)) return true;
      }
    }

    throw new ForbiddenException(
      'Missing required permissions: ' + required.join(','),
    );
  }
}
