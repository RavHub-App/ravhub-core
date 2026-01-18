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
import { StorageConfigService } from 'src/modules/storage/storage-config.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { StorageConfig } from 'src/entities/storage-config.entity';
import { RepositoryEntity } from 'src/entities/repository.entity';
import { Artifact } from 'src/entities/artifact.entity';
import { Backup } from 'src/entities/backup.entity';
import { AuditService } from 'src/modules/audit/audit.service';
import { LicenseService } from 'src/modules/license/license.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { ForbiddenException } from '@nestjs/common';

describe('StorageConfigService', () => {
    let service: StorageConfigService;
    let repo: any;
    let repositoryRepo: any;
    let artifactRepo: any;
    let backupRepo: any;
    let auditService: any;
    let licenseService: any;

    beforeEach(async () => {
        repo = {
            find: jest.fn(),
            findOneBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            delete: jest.fn(),
        };

        repositoryRepo = {
            find: jest.fn().mockResolvedValue([]),
        };

        artifactRepo = {
            find: jest.fn().mockResolvedValue([]),
            createQueryBuilder: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnThis(),
                getMany: jest.fn().mockResolvedValue([]),
            }),
        };

        backupRepo = {
            find: jest.fn().mockResolvedValue([]),
        };

        auditService = {
            logSuccess: jest.fn().mockResolvedValue(undefined),
        };

        licenseService = {
            hasActiveLicense: jest.fn(),
        };

        const mockStorageService = {};

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                StorageConfigService,
                {
                    provide: getRepositoryToken(StorageConfig),
                    useValue: repo,
                },
                {
                    provide: getRepositoryToken(RepositoryEntity),
                    useValue: repositoryRepo,
                },
                {
                    provide: getRepositoryToken(Artifact),
                    useValue: artifactRepo,
                },
                {
                    provide: getRepositoryToken(Backup),
                    useValue: backupRepo,
                },
                {
                    provide: AuditService,
                    useValue: auditService,
                },
                {
                    provide: LicenseService,
                    useValue: licenseService,
                },
                {
                    provide: StorageService,
                    useValue: mockStorageService,
                },
            ],
        }).compile();

        service = module.get<StorageConfigService>(StorageConfigService);
        jest.clearAllMocks();
    });

    it('should be defined', () => {
        expect(service).toBeDefined();
    });

    describe('list', () => {
        it('should return all storage configs', async () => {
            const configs = [
                { id: '1', key: 'local', type: 'filesystem' },
                { id: '2', key: 's3', type: 's3' },
            ];
            repo.find.mockResolvedValue(configs);

            const result = await service.list();

            expect(result).toEqual(configs);
            expect(repo.find).toHaveBeenCalled();
        });
    });

    describe('get', () => {
        it('should return a specific storage config', async () => {
            const config = { id: '1', key: 'local', type: 'filesystem' };
            repo.findOneBy.mockResolvedValue(config);

            const result = await service.get('1');

            expect(result).toEqual(config);
            expect(repo.findOneBy).toHaveBeenCalledWith({ id: '1' });
        });
    });

    describe('create', () => {
        it('should create a filesystem storage config', async () => {
            const configData = { key: 'local', type: 'filesystem', config: {} };
            const createdConfig = { id: '1', ...configData };

            repo.create.mockReturnValue(createdConfig);
            repo.save.mockResolvedValue(createdConfig);

            const result = await service.create(configData);

            expect(result).toEqual(createdConfig);
            expect(repo.create).toHaveBeenCalledWith(configData);
            expect(auditService.logSuccess).toHaveBeenCalledWith({
                action: 'storage-config.create',
                entityType: 'storage-config',
                entityId: '1',
                details: { key: 'local', type: 'filesystem' },
            });
        });

        it('should create S3 storage config with valid license', async () => {
            const configData = { key: 's3-prod', type: 's3', config: {} };
            const createdConfig = { id: '2', ...configData };

            licenseService.hasActiveLicense.mockResolvedValue(true);
            repo.create.mockReturnValue(createdConfig);
            repo.save.mockResolvedValue(createdConfig);

            const result = await service.create(configData);

            expect(result).toEqual(createdConfig);
            expect(licenseService.hasActiveLicense).toHaveBeenCalled();
        });

        it('should reject S3 storage without license', async () => {
            const configData = { key: 's3-prod', type: 's3', config: {} };
            licenseService.hasActiveLicense.mockResolvedValue(false);

            await expect(service.create(configData)).rejects.toThrow(ForbiddenException);
        });

        it('should reject GCS storage without license', async () => {
            const configData = { key: 'gcs-prod', type: 'gcs', config: {} };
            licenseService.hasActiveLicense.mockResolvedValue(false);

            await expect(service.create(configData)).rejects.toThrow(ForbiddenException);
        });

        it('should reject Azure storage without license', async () => {
            const configData = { key: 'azure-prod', type: 'azure', config: {} };
            licenseService.hasActiveLicense.mockResolvedValue(false);

            await expect(service.create(configData)).rejects.toThrow(ForbiddenException);
        });

        it('should handle audit logging failure gracefully', async () => {
            const configData = { key: 'test', type: 'filesystem' };
            const createdConfig = { id: '3', ...configData };

            repo.create.mockReturnValue(createdConfig);
            repo.save.mockResolvedValue(createdConfig);
            auditService.logSuccess.mockRejectedValue(new Error('Audit failed'));

            const result = await service.create(configData);

            expect(result).toEqual(createdConfig);
        });
    });

    describe('update', () => {
        it('should update a storage config', async () => {
            const existingConfig = { id: '1', key: 'local', type: 'filesystem' };
            const updateData = { key: 'local-updated' };
            const updatedConfig = { ...existingConfig, ...updateData };

            repo.findOneBy.mockResolvedValue(existingConfig);
            repo.save.mockResolvedValue(updatedConfig);

            const result = await service.update('1', updateData);

            expect(result).toEqual(updatedConfig);
            expect(auditService.logSuccess).toHaveBeenCalledWith({
                action: 'storage-config.update',
                entityType: 'storage-config',
                entityId: '1',
                details: { key: 'local-updated', changedFields: ['key'] },
            });
        });

        it('should return null if config not found', async () => {
            repo.findOneBy.mockResolvedValue(null);

            const result = await service.update('999', { key: 'test' });

            expect(result).toBeNull();
        });
    });

    describe('delete', () => {
        it('should delete a storage config', async () => {
            const config = { id: '1', key: 'local' };
            repo.findOneBy.mockResolvedValue(config);
            repo.delete.mockResolvedValue({ affected: 1 });

            const result = await service.delete('1');

            expect(result).toEqual({ ok: true });
            expect(repo.delete).toHaveBeenCalledWith({ id: '1' });
            expect(auditService.logSuccess).toHaveBeenCalledWith({
                action: 'storage-config.delete',
                entityType: 'storage-config',
                entityId: '1',
                details: { key: 'local' },
            });
        });

        it('should handle deletion when config not found', async () => {
            repo.findOneBy.mockResolvedValue(null);
            repo.delete.mockResolvedValue({ affected: 0 });

            const result = await service.delete('999');

            expect(result).toEqual({ ok: true });
        });
    });
});
