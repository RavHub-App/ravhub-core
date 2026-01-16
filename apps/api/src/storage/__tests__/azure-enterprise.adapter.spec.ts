import { AzureEnterpriseAdapter } from '../adapters/azure-enterprise.adapter';
import { BlobServiceClient } from '@azure/storage-blob';

// Mock Azure SDK
jest.mock('@azure/storage-blob');

describe('AzureEnterpriseAdapter', () => {
    let adapter: AzureEnterpriseAdapter;
    let mockBlobServiceClient: jest.Mocked<BlobServiceClient>;
    let mockContainerClient: any;
    let mockBlockBlobClient: any;

    beforeEach(() => {
        // Setup mocks
        mockBlockBlobClient = {
            upload: jest.fn().mockResolvedValue({}),
            uploadStream: jest.fn().mockResolvedValue({}),
            download: jest.fn().mockResolvedValue({
                readableStreamBody: Buffer.from('test content'),
            }),
            exists: jest.fn().mockResolvedValue(true),
            delete: jest.fn().mockResolvedValue({}),
            getProperties: jest.fn().mockResolvedValue({
                contentLength: 1024,
            }),
        };

        mockContainerClient = {
            createIfNotExists: jest.fn().mockResolvedValue({}),
            getBlockBlobClient: jest.fn().mockReturnValue(mockBlockBlobClient),
        };

        mockBlobServiceClient = {
            getContainerClient: jest.fn().mockReturnValue(mockContainerClient),
        } as any;

        (BlobServiceClient.fromConnectionString as jest.Mock).mockReturnValue(mockBlobServiceClient);

        adapter = new AzureEnterpriseAdapter({
            connectionString: 'DefaultEndpointsProtocol=https;AccountName=test;AccountKey=test==;EndpointSuffix=core.windows.net',
            container: 'test-container',
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with connection string and container', () => {
            expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(
                expect.stringContaining('AccountName=test')
            );
            expect(mockBlobServiceClient.getContainerClient).toHaveBeenCalledWith('test-container');
        });

        it('should support Azurite emulator for local development', () => {
            const emulatorConnectionString = 'UseDevelopmentStorage=true';

            new AzureEnterpriseAdapter({
                connectionString: emulatorConnectionString,
                container: 'dev-container',
            });

            expect(BlobServiceClient.fromConnectionString).toHaveBeenCalledWith(emulatorConnectionString);
        });
    });

    describe('save', () => {
        it('should upload blob to Azure storage', async () => {
            const key = 'test/file.txt';
            const data = Buffer.from('test content');

            const result = await adapter.save(key, data);

            expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(key);
            expect(mockBlockBlobClient.upload).toHaveBeenCalled();
            expect(result).toHaveProperty('ok', true);
        });

    });

    describe('getStream', () => {
        it('should download blob as stream from Azure storage', async () => {
            const key = 'test/file.txt';

            const result = await adapter.getStream(key);

            expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(key);
            expect(mockBlockBlobClient.download).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        it('should support range requests for partial downloads', async () => {
            const key = 'test/large-file.bin';

            await adapter.getStream(key, { start: 0, end: 1023 });

            expect(mockBlockBlobClient.download).toHaveBeenCalled();
        });
    });

    describe('exists', () => {
        it('should return true when blob exists', async () => {
            mockBlockBlobClient.exists.mockResolvedValue(true);

            const result = await adapter.exists('test/file.txt');

            expect(result).toBe(true);
        });

        it('should return false when blob does not exist', async () => {
            mockBlockBlobClient.exists.mockResolvedValue(false);

            const result = await adapter.exists('test/missing.txt');

            expect(result).toBe(false);
        });
    });

    describe('delete', () => {
        it('should delete blob from Azure storage', async () => {
            const key = 'test/file-to-delete.txt';

            await adapter.delete(key);

            expect(mockContainerClient.getBlockBlobClient).toHaveBeenCalledWith(key);
            expect(mockBlockBlobClient.delete).toHaveBeenCalled();
        });
    });

    describe('error handling', () => {
        it('should handle upload failures gracefully', async () => {
            mockBlockBlobClient.upload.mockRejectedValue(new Error('Network error'));

            const result = await adapter.save('test.txt', Buffer.from('test'));

            expect(result).toEqual({ ok: false, message: 'Network error' });
        });
    });
});
