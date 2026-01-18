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
import { MonitorController } from 'src/modules/monitor/monitor.controller';
import { MonitorService } from 'src/modules/monitor/monitor.service';

describe('MonitorController', () => {
    let controller: MonitorController;
    let service: MonitorService;

    const mockMonitorService = {
        getBasicMetrics: jest.fn(),
        aggregate: jest.fn(),
        getDetailedMetrics: jest.fn(),
        getRecentArtifacts: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [MonitorController],
            providers: [
                {
                    provide: MonitorService,
                    useValue: mockMonitorService,
                },
            ],
        }).compile();

        controller = module.get<MonitorController>(MonitorController);
        service = module.get<MonitorService>(MonitorService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('metrics', () => {
        it('should return combined metrics without prefix', async () => {
            const basicMetrics = {
                totalRepositories: 10,
                totalArtifacts: 100,
                totalUsers: 5,
            };
            const aggregated = {
                npm: { count: 50, size: 1024 },
                docker: { count: 30, size: 2048 },
            };
            const detailedMetrics = {
                storageUsed: 3072,
                cacheHitRate: 0.85,
            };
            const recentArtifacts = [
                { id: '1', name: 'pkg1', version: '1.0.0' },
                { id: '2', name: 'pkg2', version: '2.0.0' },
            ];

            mockMonitorService.getBasicMetrics.mockResolvedValue(basicMetrics);
            mockMonitorService.aggregate.mockResolvedValue(aggregated);
            mockMonitorService.getDetailedMetrics.mockResolvedValue(detailedMetrics);
            mockMonitorService.getRecentArtifacts.mockResolvedValue(recentArtifacts);

            const result = await controller.metrics();

            expect(result).toEqual({
                ...basicMetrics,
                aggregated,
                ...detailedMetrics,
                recentArtifacts,
            });
            expect(service.getBasicMetrics).toHaveBeenCalled();
            expect(service.aggregate).toHaveBeenCalledWith(undefined);
            expect(service.getDetailedMetrics).toHaveBeenCalled();
            expect(service.getRecentArtifacts).toHaveBeenCalledWith(10);
        });

        it('should return metrics with prefix filter', async () => {
            mockMonitorService.getBasicMetrics.mockResolvedValue({});
            mockMonitorService.aggregate.mockResolvedValue({ npm: { count: 50 } });
            mockMonitorService.getDetailedMetrics.mockResolvedValue({});
            mockMonitorService.getRecentArtifacts.mockResolvedValue([]);

            await controller.metrics('npm');

            expect(service.aggregate).toHaveBeenCalledWith('npm');
        });

        it('should handle empty metrics', async () => {
            mockMonitorService.getBasicMetrics.mockResolvedValue({});
            mockMonitorService.aggregate.mockResolvedValue({});
            mockMonitorService.getDetailedMetrics.mockResolvedValue({});
            mockMonitorService.getRecentArtifacts.mockResolvedValue([]);

            const result = await controller.metrics();

            expect(result).toEqual({
                aggregated: {},
                recentArtifacts: [],
            });
        });
    });
});
