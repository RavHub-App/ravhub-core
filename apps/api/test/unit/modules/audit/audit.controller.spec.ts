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
import { AuditController } from 'src/modules/audit/audit.controller';
import { AuditService } from 'src/modules/audit/audit.service';

describe('AuditController', () => {
    let controller: AuditController;
    let service: AuditService;

    const mockAuditService = {
        query: jest.fn(),
        getRecent: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [AuditController],
            providers: [
                {
                    provide: AuditService,
                    useValue: mockAuditService,
                },
            ],
        })
            .overrideGuard(require('src/modules/rbac/permissions.guard').PermissionsGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<AuditController>(AuditController);
        service = module.get<AuditService>(AuditService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('query', () => {
        it('should query audit logs with all filters', async () => {
            const auditLogs = [
                { id: '1', action: 'user.create', status: 'success', userId: 'u1' },
                { id: '2', action: 'repo.delete', status: 'success', userId: 'u1' },
            ];
            mockAuditService.query.mockResolvedValue(auditLogs);

            const result = await controller.query(
                'u1',
                'user.create',
                'user',
                'e1',
                'success',
                '2024-01-01',
                '2024-12-31',
                '10',
                '0',
            );

            expect(result).toEqual(auditLogs);
            expect(service.query).toHaveBeenCalledWith({
                userId: 'u1',
                action: 'user.create',
                entityType: 'user',
                entityId: 'e1',
                status: 'success',
                startDate: new Date('2024-01-01'),
                endDate: new Date('2024-12-31'),
                limit: 10,
                offset: 0,
            });
        });

        it('should use default limit and offset when not provided', async () => {
            mockAuditService.query.mockResolvedValue([]);

            await controller.query();

            expect(service.query).toHaveBeenCalledWith({
                userId: undefined,
                action: undefined,
                entityType: undefined,
                entityId: undefined,
                status: undefined,
                startDate: undefined,
                endDate: undefined,
                limit: 50,
                offset: 0,
            });
        });

        it('should filter by userId only', async () => {
            const auditLogs = [{ id: '1', userId: 'u1' }];
            mockAuditService.query.mockResolvedValue(auditLogs);

            await controller.query('u1');

            expect(service.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'u1',
                    limit: 50,
                    offset: 0,
                }),
            );
        });

        it('should filter by action only', async () => {
            mockAuditService.query.mockResolvedValue([]);

            await controller.query(undefined, 'repo.create');

            expect(service.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    action: 'repo.create',
                }),
            );
        });

        it('should filter by status', async () => {
            mockAuditService.query.mockResolvedValue([]);

            await controller.query(undefined, undefined, undefined, undefined, 'failure');

            expect(service.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    status: 'failure',
                }),
            );
        });

        it('should handle date range filtering', async () => {
            mockAuditService.query.mockResolvedValue([]);

            await controller.query(
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                '2024-01-01',
                '2024-01-31',
            );

            expect(service.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    startDate: new Date('2024-01-01'),
                    endDate: new Date('2024-01-31'),
                }),
            );
        });

        it('should parse custom limit and offset', async () => {
            mockAuditService.query.mockResolvedValue([]);

            await controller.query(
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                '100',
                '50',
            );

            expect(service.query).toHaveBeenCalledWith(
                expect.objectContaining({
                    limit: 100,
                    offset: 50,
                }),
            );
        });
    });

    describe('getRecent', () => {
        it('should get recent audit logs with default limit', async () => {
            const recentLogs = [
                { id: '1', action: 'user.login', timestamp: new Date() },
                { id: '2', action: 'repo.create', timestamp: new Date() },
            ];
            mockAuditService.getRecent.mockResolvedValue(recentLogs);

            const result = await controller.getRecent();

            expect(result).toEqual(recentLogs);
            expect(service.getRecent).toHaveBeenCalledWith(100);
        });

        it('should get recent audit logs with custom limit', async () => {
            mockAuditService.getRecent.mockResolvedValue([]);

            await controller.getRecent('25');

            expect(service.getRecent).toHaveBeenCalledWith(25);
        });
    });
});
