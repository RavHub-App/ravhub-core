/*
 * Copyright (C) 2026 RavHub Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { PluginManagerService } from '../../src/modules/plugins/plugin-manager.service';
import { ProxyCacheJobService } from '../../src/modules/plugins/proxy-cache-job.service';
import { UsersService } from '../../src/modules/users/users.service';
import { UnifiedPermissionGuard } from '../../src/modules/rbac/unified-permission.guard';
import { PermissionsGuard } from '../../src/modules/rbac/permissions.guard';
import { PermissionService } from '../../src/modules/rbac/permission.service';
import { seedDefaults } from '../../src/seeds/seed-defaults';
import AppDataSource from '../../src/data-source';
import { Role } from '../../src/entities/role.entity';
import * as bcrypt from 'bcryptjs';

export interface TestContext {
    app: INestApplication;
    adminUserId: string;
    authToken: string;
}

export async function setupTestApp(): Promise<TestContext> {
    let adminUserId: string;

    const dbFile = `./test-e2e-${process.env.JEST_WORKER_ID || '1'}.sqlite`;
    process.env.DB_TYPE = 'sqlite';
    process.env.POSTGRES_DB = dbFile; // Use file db to share connection between AppDataSource and TypeORM module
    process.env.TYPEORM_SYNC = 'true';

    // Clean up previous test db
    const fs = require('fs');
    if (fs.existsSync(dbFile)) {
        try { fs.unlinkSync(dbFile); } catch (e) { }
    }
    process.env.JWT_SECRET = 'test-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
    })
        .overrideProvider(PluginManagerService)
        .useValue({
            onModuleInit: jest.fn(),
            startJobProcessor: jest.fn(),
            getUpstreamPingStatus: jest.fn().mockReturnValue(null),
            triggerUpstreamPingForRepo: jest.fn(),
            getPluginForRepo: jest.fn().mockReturnValue(null),
        })
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
            checkPermission: jest.fn().mockResolvedValue({ granted: true, level: 'superadmin' }),
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
        }
    });

    await app.init();

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
            roles: adminRole ? [adminRole] : []
        });
        adminUserId = created.id;
    } else {
        adminUserId = existingAdmin.id;
    }

    return {
        app,
        adminUserId,
        authToken: '', // Will be set after login
    };
}

export async function cleanupTestApp(app: INestApplication): Promise<void> {
    await app.close();
}
