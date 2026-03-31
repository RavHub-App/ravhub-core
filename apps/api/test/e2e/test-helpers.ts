/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

export interface TestContext {
  app: INestApplication;
  adminUserId: string;
  authToken: string;
}

export interface TestOptions {
  useRealPlugins?: boolean;
}

export async function setupTestApp(
  options: TestOptions = {},
): Promise<TestContext> {
  let adminUserId: string;

  const workerId = process.env.JEST_WORKER_ID || '1';
  const storagePath = `./test-storage-${process.env.JEST_WORKER_ID || '1'}`;
  process.env.DB_TYPE = 'postgres';
  process.env.POSTGRES_HOST = process.env.E2E_POSTGRES_HOST || '127.0.0.1';
  process.env.POSTGRES_PORT = process.env.E2E_POSTGRES_PORT || '54329';
  process.env.POSTGRES_USER = process.env.E2E_POSTGRES_USER || 'postgres';
  process.env.POSTGRES_PASSWORD =
    process.env.E2E_POSTGRES_PASSWORD || 'postgres';
  process.env.POSTGRES_DB = process.env.E2E_POSTGRES_DB || 'ravhub';
  process.env.TYPEORM_SYNC = 'true';
  process.env.TYPEORM_DROP_SCHEMA = 'true';
  process.env.STORAGE_PATH = storagePath;
  process.env.REDIS_ENABLED = 'false';
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_STARTUP_TASKS = 'true';

  // Clean up
  const fs = require('fs');
  if (fs.existsSync(storagePath)) {
    try {
      fs.rmSync(storagePath, { recursive: true, force: true });
    } catch (e) {}
  }

  process.env.JWT_SECRET = 'test-secret';

  const { AppModule } = await import('../../src/app.module');
  const { PluginManagerService } =
    await import('../../src/modules/plugins/plugin-manager.service');
  const { ProxyCacheJobService } =
    await import('../../src/modules/plugins/proxy-cache-job.service');
  const { UsersService } =
    await import('../../src/modules/users/users.service');
  const { UnifiedPermissionGuard } =
    await import('../../src/modules/rbac/unified-permission.guard');
  const { PermissionsGuard } =
    await import('../../src/modules/rbac/permissions.guard');
  const { PermissionService } =
    await import('../../src/modules/rbac/permission.service');
  const { seedDefaults } = await import('../../src/seeds/seed-defaults');
  const { default: AppDataSource } = await import('../../src/data-source');
  const { Role } = await import('../../src/entities/role.entity');

  const builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (!options.useRealPlugins) {
    builder.overrideProvider(PluginManagerService).useValue({
      onModuleInit: jest.fn(),
      startJobProcessor: jest.fn(),
      getUpstreamPingStatus: jest.fn().mockReturnValue(null),
      triggerUpstreamPingForRepo: jest.fn(),
      getPluginForRepo: jest.fn().mockReturnValue(null),
      getCacheStats: jest
        .fn()
        .mockResolvedValue({ byRepository: {}, total: 0 }),
      clearProxyCache: jest.fn().mockResolvedValue(true),
      cleanupProxyCache: jest.fn().mockResolvedValue(0),
      clearAllProxyCache: jest.fn().mockResolvedValue(0),
      proxyFetch: jest
        .fn()
        .mockResolvedValue({ ok: true, status: 200, body: Buffer.from('') }),
      authenticate: jest.fn().mockResolvedValue({
        ok: true,
        token: 'mock-token',
        user: { username: 'mock' },
      }),
      upload: jest.fn().mockResolvedValue({ ok: true }),
      download: jest.fn().mockResolvedValue({ ok: true, url: 'http://mock' }),
      listVersions: jest.fn().mockResolvedValue([]),
      handlePut: jest.fn().mockResolvedValue({ ok: true }),
    });
  }

  const moduleFixture: TestingModule = await builder
    .overrideProvider(ProxyCacheJobService)
    .useValue({
      startJobProcessor: jest.fn(),
      startProxyCacheCleanupScheduler: jest.fn(),
      onModuleDestroy: jest.fn(),
    })
    .overrideProvider(PermissionService)
    .useValue({
      getUserRepositoryPermission: jest.fn().mockResolvedValue(null),
      hasPermission: jest.fn().mockResolvedValue(true),
      checkPermission: jest
        .fn()
        .mockResolvedValue({ granted: true, level: 'superadmin' }),
    })
    .overrideGuard(UnifiedPermissionGuard)
    .useValue({
      canActivate: (context: any) => {
        const request = context.switchToHttp().getRequest();
        if (!request.user && adminUserId) {
          request.user = { id: adminUserId, username: 'admin' };
        }
        return true;
      },
    })
    .overrideGuard(PermissionsGuard)
    .useValue({
      canActivate: () => true,
    })
    .compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());

  app.useGlobalInterceptors({
    intercept(context, next) {
      const request = context.switchToHttp().getRequest();
      if (!request.user && adminUserId) {
        request.user = { id: adminUserId, username: 'admin' };
      }
      return next.handle();
    },
  });

  await app.init();

  // Disable upstream ping scheduler during tests to avoid leaks
  if (process.env.NODE_ENV === 'test') {
    const pm = moduleFixture.get(PluginManagerService);
    if (pm && (pm as any).pingTimeout) clearTimeout((pm as any).pingTimeout);
    const ups = moduleFixture.get(
      require('../../src/modules/plugins/upstream-ping.service')
        .UpstreamPingService,
    );
    if (ups) ups.onModuleDestroy();
  }

  await seedDefaults();

  const usersService = moduleFixture.get(UsersService);
  const roleRepo = AppDataSource.getRepository(Role);

  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('password', salt);

  const adminRole = await roleRepo.findOne({ where: { name: 'admin' } });

  const existingAdmin = await usersService.findByUsername('admin');
  if (!existingAdmin) {
    const created = await usersService.create({
      username: 'admin',
      passwordhash: hash,
      roles: adminRole ? [adminRole] : [],
    });
    adminUserId = created.id;
  } else {
    adminUserId = existingAdmin.id;
  }

  return {
    app,
    adminUserId,
    authToken: '',
  };
}

export async function cleanupTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }

  try {
    const { default: AppDataSource } = await import('../../src/data-source');
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  } catch (e) {}

  const storagePath = `./test-storage-${process.env.JEST_WORKER_ID || '1'}`;
  const fs = require('fs');
  if (fs.existsSync(storagePath)) {
    try {
      fs.rmSync(storagePath, { recursive: true, force: true });
    } catch (e) {}
  }
}
