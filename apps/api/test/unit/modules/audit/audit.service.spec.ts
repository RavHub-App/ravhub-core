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

import { AuditService } from 'src/modules/audit/audit.service';
import { AuditLog } from 'src/entities/audit-log.entity';
import { Repository } from 'typeorm';

describe('AuditService (Unit)', () => {
  let service: AuditService;
  let repo: jest.Mocked<Repository<AuditLog>>;

  beforeEach(() => {
    repo = {
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: '1', ...d })),
      findAndCount: jest.fn(),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    } as any;
    service = new AuditService(repo);
  });

  it('should log an event', async () => {
    const res = await service.log({ action: 'test', userId: 'u1' });
    expect(res.action).toBe('test');
    expect(repo.save).toHaveBeenCalled();
  });

  it('should log success', async () => {
    const res = await service.logSuccess({ action: 'ok' });
    expect(res.status).toBe('success');
  });

  it('should log failure', async () => {
    const res = await service.logFailure({ action: 'fail', error: 'err' });
    expect(res.status).toBe('failure');
    expect(res.error).toBe('err');
  });

  it('should query logs', async () => {
    repo.findAndCount.mockResolvedValue([[], 0]);
    const res = await service.query({ status: 'success' });
    expect(res.total).toBe(0);
    expect(repo.findAndCount).toHaveBeenCalled();
  });

  it('should delete older logs', async () => {
    const mockExecute = jest.fn().mockResolvedValue({ affected: 5 });
    const mockQueryBuilder: any = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: mockExecute,
    };
    repo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

    const affected = await service.deleteOlderThan(30);
    expect(affected).toBe(5);
  });

  it('should get recent logs', async () => {
    repo.find.mockResolvedValue([]);
    await service.getRecent(10);
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
      }),
    );
  });
});
