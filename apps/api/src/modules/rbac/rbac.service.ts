import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { Repository, In } from 'typeorm';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role) private roleRepo: Repository<Role>,
    @InjectRepository(Permission) private permRepo: Repository<Permission>,
    private readonly auditService: AuditService,
  ) {}

  getRoles() {
    return this.roleRepo.find({ relations: ['permissions'] });
  }

  async getRole(id: string) {
    const role = await this.roleRepo.findOne({
      where: { id },
      relations: ['permissions'],
    });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }

  async createRole(data: {
    name: string;
    description?: string;
    permissions?: string[];
  }) {
    const role = this.roleRepo.create({
      name: data.name,
      description: data.description,
    });

    if (data.permissions && data.permissions.length > 0) {
      const perms = await this.permRepo.find({
        where: { key: In(data.permissions) },
      });
      role.permissions = perms;
    }

    const saved = await this.roleRepo.save(role);

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'role.create',
        entityType: 'role',
        entityId: saved.id,
        details: { name: data.name, permissions: data.permissions },
      })
      .catch(() => {});

    return saved;
  }

  async updateRole(
    id: string,
    data: { name?: string; description?: string; permissions?: string[] },
  ) {
    const role = await this.getRole(id);

    if (data.name) role.name = data.name;
    if (data.description !== undefined) role.description = data.description;

    if (data.permissions !== undefined) {
      if (data.permissions.length > 0) {
        const perms = await this.permRepo.find({
          where: { key: In(data.permissions) },
        });
        role.permissions = perms;
      } else {
        role.permissions = [];
      }
    }

    const saved = await this.roleRepo.save(role);

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'role.update',
        entityType: 'role',
        entityId: id,
        details: { name: data.name, permissions: data.permissions },
      })
      .catch(() => {});

    return saved;
  }

  async deleteRole(id: string) {
    const role = await this.getRole(id);
    await this.roleRepo.remove(role);

    // Log audit event
    await this.auditService
      .logSuccess({
        action: 'role.delete',
        entityType: 'role',
        entityId: id,
        details: { name: role.name },
      })
      .catch(() => {});

    return { ok: true };
  }

  getPermissions() {
    return this.permRepo.find();
  }
}
