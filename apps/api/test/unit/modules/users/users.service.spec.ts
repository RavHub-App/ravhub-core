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

import { UsersService } from 'src/modules/users/users.service';
import { User } from 'src/entities/user.entity';
import { Repository } from 'typeorm';

describe('UsersService (Unit)', () => {
  let service: UsersService;
  let repo: jest.Mocked<Repository<User>>;
  let auditService: any;
  let licenseService: any;

  beforeEach(() => {
    repo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
      create: jest.fn().mockImplementation((d) => d),
      save: jest
        .fn()
        .mockImplementation((d) => Promise.resolve({ id: 'u1', ...d })),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    } as any;
    auditService = {
      logSuccess: jest.fn().mockResolvedValue({}),
    };
    licenseService = {};
    service = new UsersService(repo, auditService, licenseService);
  });

  it('should find all users', async () => {
    await service.findAll();
    expect(repo.find).toHaveBeenCalledWith(
      expect.objectContaining({
        relations: expect.arrayContaining(['roles']),
      }),
    );
  });

  it('should find one user by id', async () => {
    await service.findOne('u1');
    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
      }),
    );
  });

  it('should find by username', async () => {
    await service.findByUsername('testuser');
    expect(repo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { username: 'testuser' },
      }),
    );
  });

  it('should create a user', async () => {
    const userData = { username: 'newuser' };
    repo.findOne.mockResolvedValue({ id: 'u1', username: 'newuser' } as any);

    const res = await service.create(userData);
    expect(res.username).toBe('newuser');
    expect(repo.save).toHaveBeenCalled();
    expect(auditService.logSuccess).toHaveBeenCalled();
  });

  it('should update a user', async () => {
    repo.findOne.mockResolvedValue({ id: 'u1', username: 'updated' } as any);
    const res = await service.update('u1', { username: 'updated' });
    expect(repo.update).toHaveBeenCalledWith('u1', { username: 'updated' });
    expect(res?.username).toBe('updated');
  });

  it('should delete a user', async () => {
    repo.findOne.mockResolvedValue({ id: 'u1', username: 'todelete' } as any);
    await service.delete('u1');
    expect(repo.delete).toHaveBeenCalledWith('u1');
    expect(auditService.logSuccess).toHaveBeenCalled();
  });

  it('should not log audit if user not found on delete', async () => {
    repo.findOne.mockResolvedValue(null);
    await service.delete('u1');
    expect(repo.delete).toHaveBeenCalledWith('u1');
    expect(auditService.logSuccess).not.toHaveBeenCalled();
  });
});
