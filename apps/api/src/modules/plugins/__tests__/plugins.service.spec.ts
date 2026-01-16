
import { Test, TestingModule } from '@nestjs/testing';
import { PluginsService } from '../plugins.service';
import { StorageService } from '../../storage/storage.service';
import { MonitorService } from '../../monitor/monitor.service';
import { AuditService } from '../../audit/audit.service';
import { RedisService } from '../../redis/redis.service';
import { RedlockService } from '../../redis/redlock.service';
import AppDataSource from '../../../data-source';
import { License } from '../../../entities/license.entity';

// Mock dependencies
const mockStorageService = {};
const mockMonitorService = {};
const mockAuditService = {};
const mockRedisService = {};
const mockRedlockService = {};

// Mock AppDataSource module before import in test body if possible, but here we can hoist
const mockLicenseRepo = {
    findOne: jest.fn(),
};
const mockPluginRepo = {
    findOneBy: jest.fn(),
    create: jest.fn((dto) => dto),
    save: jest.fn(),
};

jest.mock('../../../data-source', () => ({
    __esModule: true,
    default: {
        isInitialized: true,
        initialize: jest.fn().mockResolvedValue(true),
        getRepository: jest.fn((entity: any) => {
            // We can identify entity by name if class instance comparison fails across modules
            if (entity.name === 'License') return mockLicenseRepo;
            return mockPluginRepo;
        }),
    },
}));

describe('PluginsService', () => {
    let service: PluginsService;

    beforeEach(async () => {
        // Reset mocks
        mockLicenseRepo.findOne.mockReset();

        const module: TestingModule = await Test.createTestingModule({
            providers: [
                PluginsService,
                { provide: StorageService, useValue: mockStorageService },
                { provide: MonitorService, useValue: mockMonitorService },
                { provide: AuditService, useValue: mockAuditService },
                { provide: RedisService, useValue: mockRedisService },
                { provide: RedlockService, useValue: mockRedlockService },
            ],
        }).compile();

        service = module.get<PluginsService>(PluginsService);
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should restrict plugins to basics when no active license is found (Community Edition)', async () => {
        // Arrange: No license found
        mockLicenseRepo.findOne.mockResolvedValue(null);

        // Act
        await service.onModuleInit();

        // Assert
        const loaded = service.list();
        const loadedKeys = loaded.map((p) => p.key);

        expect(loadedKeys).toContain('npm');
        expect(loadedKeys).toContain('pypi');
        expect(loadedKeys).toContain('docker');
        expect(loadedKeys).toContain('maven');

        // Enterprise plugins should NOT be present
        expect(loadedKeys).not.toContain('nuget');
        expect(loadedKeys).not.toContain('composer');
        expect(loadedKeys).not.toContain('helm');
        expect(loadedKeys).not.toContain('rust');
        expect(loadedKeys).not.toContain('raw');
    });

    it('should load all plugins when an active license is found (Enterprise Edition)', async () => {
        // Arrange: Active license found
        mockLicenseRepo.findOne.mockResolvedValue({ id: 'valid-license', isActive: true });

        // Act
        await service.onModuleInit();

        // Assert
        const loaded = service.list();
        const loadedKeys = loaded.map((p) => p.key);

        // All plugins should be present
        expect(loadedKeys).toContain('npm');
        expect(loadedKeys).toContain('pypi');
        expect(loadedKeys).toContain('docker');
        expect(loadedKeys).toContain('maven');
        expect(loadedKeys).toContain('nuget');
        expect(loadedKeys).toContain('composer');
        expect(loadedKeys).toContain('helm');
        expect(loadedKeys).toContain('rust');
        expect(loadedKeys).toContain('raw');
    });

    it('should dynamically reload plugins after license activation', async () => {
        // Arrange: Start with no license (Community Edition)
        mockLicenseRepo.findOne.mockResolvedValue(null);

        // Act: Initialize with Community Edition
        await service.onModuleInit();

        // Assert: Only community plugins loaded
        let loaded = service.list();
        let loadedKeys = loaded.map((p) => p.key);

        expect(loadedKeys).toHaveLength(4);
        expect(loadedKeys).toContain('npm');
        expect(loadedKeys).not.toContain('nuget');

        // Arrange: Activate license
        mockLicenseRepo.findOne.mockResolvedValue({
            id: 'test-license',
            key: 'ENTERPRISE-KEY',
            isActive: true,
            signedToken: 'valid-token',
        } as any);

        // Act: Reload plugins with new license
        const reloadResult = await service.reloadPlugins();

        // Assert: Reload was successful
        expect(reloadResult.ok).toBe(true);
        expect(reloadResult.newPlugins).toHaveLength(5);
        expect(reloadResult.newPlugins).toContain('nuget');
        expect(reloadResult.newPlugins).toContain('composer');
        expect(reloadResult.newPlugins).toContain('helm');
        expect(reloadResult.newPlugins).toContain('rust');
        expect(reloadResult.newPlugins).toContain('raw');
        expect(reloadResult.message).toContain('Successfully enabled 5 enterprise plugins');

        // Assert: All plugins now loaded
        loaded = service.list();
        loadedKeys = loaded.map((p) => p.key);

        expect(loadedKeys).toHaveLength(9);
        expect(loadedKeys).toContain('nuget');
    });
});
