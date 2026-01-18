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

import { CleanupController } from 'src/modules/cleanup/cleanup.controller';
import { CleanupService } from 'src/modules/cleanup/cleanup.service';

describe('CleanupController (Unit)', () => {
  let controller: CleanupController;
  let service: jest.Mocked<CleanupService>;

  beforeEach(() => {
    service = {
      findAll: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      execute: jest.fn(),
    } as any;
    controller = new CleanupController(service);
  });

  it('should list policies', async () => {
    service.findAll.mockResolvedValue([]);
    const res = await controller.listPolicies();
    expect(res).toEqual([]);
    expect(service.findAll).toHaveBeenCalled();
  });

  it('should create policy', async () => {
    const body = { name: 'test' };
    const req = { user: { id: 'u1' } };
    await controller.createPolicy(body, req);
    expect(service.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'test',
        createdById: 'u1',
      }),
    );
  });

  it('should execute policy', async () => {
    await controller.executePolicy('p1');
    expect(service.execute).toHaveBeenCalledWith('p1');
  });
});
