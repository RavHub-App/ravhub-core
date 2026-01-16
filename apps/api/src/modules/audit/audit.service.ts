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
  ) { }

  /**
   * Log an audit event
   */
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
      // this.logger.debug(
      //   `Audit log created: ${context.action} by user ${context.userId || 'system'}`,
      // );
      return saved;
    } catch (err) {
      this.logger.error(`Failed to create audit log: ${err.message}`);
      throw err;
    }
  }

  /**
   * Log a successful operation
   */
  async logSuccess(context: Omit<LogContext, 'status'>): Promise<AuditLog> {
    return this.log({ ...context, status: 'success' });
  }

  /**
   * Log a failed operation
   */
  async logFailure(
    context: Omit<LogContext, 'status'> & { error: string },
  ): Promise<AuditLog> {
    return this.log({ ...context, status: 'failure' });
  }

  /**
   * Query audit logs with filters
   */
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

  /**
   * Get recent logs
   */
  async getRecent(limit = 100): Promise<AuditLog[]> {
    return this.auditRepo.find({
      relations: ['user'],
      order: { timestamp: 'DESC' },
      take: limit,
    });
  }

  /**
   * Delete old audit logs (retention policy)
   */
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
