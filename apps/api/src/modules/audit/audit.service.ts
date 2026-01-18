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
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindOptionsWhere, Between } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';

export interface LogContext {
  userId?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  status?: 'success' | 'failure';
  error?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  async log(context: LogContext): Promise<AuditLog> {
    try {
      const entry = this.auditRepo.create({
        userId: context.userId,
        action: context.action,
        entityType: context.entityType,
        entityId: context.entityId,
        details: context.details,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        status: context.status || 'success',
        error: context.error,
      });

      const saved = await this.auditRepo.save(entry);

      return saved;
    } catch (err) {
      this.logger.error(`Failed to create audit log: ${err.message}`);
      throw err;
    }
  }

  async logSuccess(context: Omit<LogContext, 'status'>): Promise<AuditLog> {
    return this.log({ ...context, status: 'success' });
  }

  async logFailure(
    context: Omit<LogContext, 'status'> & { error: string },
  ): Promise<AuditLog> {
    return this.log({ ...context, status: 'failure' });
  }

  async query(filters: {
    userId?: string;
    action?: string;
    entityType?: string;
    entityId?: string;
    status?: 'success' | 'failure';
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AuditLog[]; total: number }> {
    const where: FindOptionsWhere<AuditLog> = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.entityType) where.entityType = filters.entityType;
    if (filters.entityId) where.entityId = filters.entityId;
    if (filters.status) where.status = filters.status;

    if (filters.startDate || filters.endDate) {
      where.timestamp = Between(
        filters.startDate || new Date(0),
        filters.endDate || new Date(),
      );
    }

    const [logs, total] = await this.auditRepo.findAndCount({
      where,
      relations: ['user'],
      order: { timestamp: 'DESC' },
      take: filters.limit || 50,
      skip: filters.offset || 0,
    });

    return { logs, total };
  }

  async getRecent(limit = 100): Promise<AuditLog[]> {
    return this.auditRepo.find({
      relations: ['user'],
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  async deleteOlderThan(days: number): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.auditRepo
      .createQueryBuilder()
      .delete()
      .where('timestamp < :cutoffDate', { cutoffDate })
      .execute();

    this.logger.log(
      `Deleted ${result.affected || 0} audit logs older than ${days} days`,
    );
    return result.affected || 0;
  }
}
