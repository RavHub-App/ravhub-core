import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../entities/user.entity';
import { AuthService } from './auth.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private auth: AuthService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const headers = req.headers || {};

    if (headers['authorization']) {
      const ah = String(headers['authorization']);
      let userId: string | null = null;
      let username: string | null = null;

      if (ah.startsWith('Bearer ')) {
        const token = ah.slice('Bearer '.length).trim();
        const payload = this.auth.verifyToken(token);

        if (payload && (payload as any).sub) {
          userId = (payload as any).sub;
          username = (payload as any).username;
        } else {
          throw new UnauthorizedException('invalid or expired token');
        }
      } else if (ah.startsWith('Basic ')) {
        const b64 = ah.slice('Basic '.length).trim();
        try {
          const decoded = Buffer.from(b64, 'base64').toString('utf8');
          const idx = decoded.indexOf(':');
          if (idx !== -1) {
            const u = decoded.substring(0, idx);
            const p = decoded.substring(idx + 1);
            const validated = await this.auth.validateUser(u, p);
            if (validated) {
              userId = validated.id;
              username = validated.username;
            } else {
              throw new UnauthorizedException('invalid credentials');
            }
          }
        } catch (e) {
          throw new UnauthorizedException('invalid basic auth format');
        }
      }

      if (userId) {
        req.headers['x-user-id'] = userId;

        // Load user with roles and permissions from database
        try {
          const user = await this.userRepo.findOne({
            where: { id: userId },
            relations: ['roles', 'roles.permissions'],
          });

          if (user) {
            // Extract role names and permission keys
            const roles = (user.roles || []).map((r) => r.name);
            const permissions = new Set<string>();

            for (const role of user.roles || []) {
              // Add wildcard for superadmin/admin roles
              if (role.name === 'superadmin' || role.name === 'admin') {
                permissions.add('*');
              }
              // Add all permissions from the role
              for (const perm of role.permissions || []) {
                permissions.add(perm.key);
              }
            }

            req.user = {
              id: user.id,
              username: user.username,
              roles: roles,
              permissions: Array.from(permissions),
            };
          } else {
            // User not found in DB, use minimal info from token
            req.user = {
              id: userId,
              username: username,
              roles: [],
              permissions: [],
            };
          }
        } catch (err) {
          this.logger.warn('Failed to load user from DB: ' + err?.message);
          // Fallback to minimal info
          req.user = {
            id: userId,
            username: username,
            roles: [],
            permissions: [],
          };
        }
      }
    }

    return true;
  }
}
