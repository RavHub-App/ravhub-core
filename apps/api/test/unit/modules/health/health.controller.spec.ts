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

import { Test, TestingModule } from '@nestjs/testing';
import { HealthController } from 'src/modules/health/health.controller';
import AppDataSource from 'src/data-source';
import { Client } from 'pg';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    initialize: jest.fn(),
    query: jest.fn(),
  },
}));

jest.mock('pg', () => {
  const mClient = {
    connect: jest.fn(),
    query: jest.fn(),
    end: jest.fn(),
  };
  return { Client: jest.fn(() => mClient) };
});

describe('HealthController', () => {
  let controller: HealthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
    }).compile();

    controller = module.get<HealthController>(HealthController);
    (AppDataSource as any).isInitialized = true;
  });

  it('live should return status up', () => {
    expect(controller.live()).toEqual({ status: 'up' });
  });

  it('health should call ready', async () => {
    const spy = jest.spyOn(controller, 'ready');
    spy.mockResolvedValueOnce({ ok: true, db: true });
    await controller.health();
    expect(spy).toHaveBeenCalled();
  });

  it('ready should check db using AppDataSource when initialized', async () => {
    (AppDataSource as any).isInitialized = true;
    (AppDataSource.query as jest.Mock).mockResolvedValueOnce([]);

    const res = await controller.ready();
    expect(res).toEqual({ ok: true, db: true });
  });

  it('ready should return false if db query fails (initialized)', async () => {
    (AppDataSource as any).isInitialized = true;
    (AppDataSource.query as jest.Mock).mockRejectedValueOnce(new Error('fail'));

    const res = await controller.ready();
    expect(res).toEqual({ ok: false, db: false, message: 'fail' });
  });

  it('ready should attempt direct pg connection if DataSource not initialized', async () => {
    (AppDataSource as any).isInitialized = false;
    (AppDataSource.initialize as jest.Mock).mockRejectedValueOnce(
      new Error('ds-init-error'),
    );

    // Mock PG Client to succeed
    // Client is mocked globally but we need access to the instance methods?
    // The global mock returns a new object each time.
    // Let's rely on default mock behavior which is empty fns resolving to undefined (promise)

    const res = await controller.ready();
    // Default mock query returns undefined, so await yields.

    // Wait, Client constructor returns mocked object mClient.
    // mClient methods are jest.fn().

    expect(res).toEqual({ ok: true, db: true });
  });
});
