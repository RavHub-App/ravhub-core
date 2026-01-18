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
import { StorageConfigController } from 'src/modules/storage/storage-config.controller';
import { StorageConfigService } from 'src/modules/storage/storage-config.service';

describe('StorageConfigController', () => {
    let controller: StorageConfigController;
    let service: StorageConfigService;

    const mockStorageConfigService = {
        listWithStats: jest.fn(),
        list: jest.fn(),
        get: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            controllers: [StorageConfigController],
            providers: [
                {
                    provide: StorageConfigService,
                    useValue: mockStorageConfigService,
                },
            ],
        })
            .overrideGuard(require('src/modules/rbac/permissions.guard').PermissionsGuard)
            .useValue({ canActivate: () => true })
            .compile();

        controller = module.get<StorageConfigController>(StorageConfigController);
        service = module.get<StorageConfigService>(StorageConfigService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(controller).toBeDefined();
    });

    describe('list', () => {
        it('should return all storage configs with stats', async () => {
            const configs = [
                {
                    id: '1',
                    key: 'local',
                    type: 'filesystem',
                    stats: { repositoryCount: 5, totalSize: 1024 },
                },
                {
                    id: '2',
                    key: 's3-prod',
                    type: 's3',
                    stats: { repositoryCount: 10, totalSize: 2048 },
                },
            ];
            mockStorageConfigService.listWithStats.mockResolvedValue(configs);

            const result = await controller.list();

            expect(result).toEqual(configs);
            expect(service.listWithStats).toHaveBeenCalled();
        });
    });

    describe('get', () => {
        it('should return a specific storage config', async () => {
            const config = { id: '1', key: 'local', type: 'filesystem' };
            mockStorageConfigService.get.mockResolvedValue(config);

            const result = await controller.get('1');

            expect(result).toEqual(config);
            expect(service.get).toHaveBeenCalledWith('1');
        });
    });

    describe('create', () => {
        it('should create a storage config', async () => {
            const configData = { key: 'new-storage', type: 'filesystem', config: {} };
            const createdConfig = { id: '3', ...configData };

            mockStorageConfigService.create.mockResolvedValue(createdConfig);

            const result = await controller.create(configData);

            expect(result).toEqual(createdConfig);
            expect(service.create).toHaveBeenCalledWith(configData);
        });
    });

    describe('update', () => {
        it('should update a storage config', async () => {
            const updateData = { key: 'updated-key' };
            const updatedConfig = { id: '1', key: 'updated-key', type: 'filesystem' };

            mockStorageConfigService.update.mockResolvedValue(updatedConfig);

            const result = await controller.update('1', updateData);

            expect(result).toEqual(updatedConfig);
            expect(service.update).toHaveBeenCalledWith('1', updateData);
        });
    });

    describe('remove', () => {
        it('should delete a storage config', async () => {
            mockStorageConfigService.delete.mockResolvedValue({ ok: true });

            const result = await controller.remove('1');

            expect(result).toEqual({ ok: true });
            expect(service.delete).toHaveBeenCalledWith('1');
        });
    });
});
