import { GcsEnterpriseAdapter } from '../adapters/gcs-enterprise.adapter';
import { Storage } from '@google-cloud/storage';

// Mock GCS SDK
jest.mock('@google-cloud/storage');

describe('GcsEnterpriseAdapter', () => {
    let adapter: GcsEnterpriseAdapter;
    let mockStorage: jest.Mocked<Storage>;
    let mockBucket: any;
    let mockFile: any;

    beforeEach(() => {
        // Setup mocks
        mockFile = {
            save: jest.fn().mockResolvedValue([]),
            createWriteStream: jest.fn().mockReturnValue({
                on: jest.fn(),
                write: jest.fn(),
                end: jest.fn(),
            }),
            createReadStream: jest.fn().mockReturnValue(Buffer.from('test content')),
            exists: jest.fn().mockResolvedValue([true]),
            delete: jest.fn().mockResolvedValue([]),
            getMetadata: jest.fn().mockResolvedValue([{ size: 1024 }]),
            getSignedUrl: jest.fn().mockResolvedValue(['https://storage.googleapis.com/signed-url']),
        };

        mockBucket = {
            file: jest.fn().mockReturnValue(mockFile),
        };

        mockStorage = {
            bucket: jest.fn().mockReturnValue(mockBucket),
        } as any;

        (Storage as jest.MockedClass<typeof Storage>).mockImplementation(() => mockStorage);

        adapter = new GcsEnterpriseAdapter({
            projectId: 'test-project',
            bucket: 'test-bucket',
            keyFilePath: '/path/to/key.json',
        });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('initialization', () => {
        it('should initialize with project ID, bucket and credentials', () => {
            expect(Storage).toHaveBeenCalled();
            expect(mockStorage.bucket).toHaveBeenCalledWith('test-bucket');
        });

        it('should support fake-gcs-server emulator for local development', () => {
            process.env.STORAGE_EMULATOR_HOST = 'http://localhost:4443';

            new GcsEnterpriseAdapter({
                projectId: 'test-project',
                bucket: 'test-bucket',
            });

            expect(Storage).toHaveBeenCalled();

            delete process.env.STORAGE_EMULATOR_HOST;
        });
    });

    describe('save', () => {
        it('should upload file to GCS', async () => {
            const key = 'test/file.txt';
            const data = Buffer.from('test content');

            const result = await adapter.save(key, data);

            expect(mockBucket.file).toHaveBeenCalledWith(key);
            expect(mockFile.save).toHaveBeenCalled();
            expect(result).toHaveProperty('ok', true);
        });
    });

    describe('getStream', () => {
        it('should download file as stream from GCS', async () => {
            const key = 'test/file.txt';

            const result = await adapter.getStream(key);

            expect(mockBucket.file).toHaveBeenCalledWith(key);
            expect(mockFile.createReadStream).toHaveBeenCalled();
            expect(result).toBeDefined();
        });

        it('should support range requests for partial downloads', async () => {
            const key = 'test/large-file.bin';

            await adapter.getStream(key, { start: 0, end: 1023 });

            expect(mockFile.createReadStream).toHaveBeenCalledWith({
                start: 0,
                end: 1023,
            });
        });
    });

    describe('exists', () => {
        it('should return true when file exists', async () => {
            mockFile.exists.mockResolvedValue([true]);

            const result = await adapter.exists('test/file.txt');

            expect(result).toBe(true);
        });

        it('should return false when file does not exist', async () => {
            mockFile.exists.mockResolvedValue([false]);

            const result = await adapter.exists('test/missing.txt');

            expect(result).toBe(false);
        });
    });

    describe('delete', () => {
        it('should delete file from GCS', async () => {
            const key = 'test/file-to-delete.txt';

            await adapter.delete(key);

            expect(mockBucket.file).toHaveBeenCalledWith(key);
            expect(mockFile.delete).toHaveBeenCalled();
        });
    });

    describe('getUrl', () => {
        it('should return a URL for the file', async () => {
            const key = 'test/file.txt';

            const url = await adapter.getUrl(key);

            // May return signed URL or gcs:// URL depending on implementation
            expect(url).toBeDefined();
            expect(typeof url).toBe('string');
        });
    });

    describe('error handling', () => {
        it('should handle upload failures gracefully', async () => {
            mockFile.save.mockRejectedValue(new Error('Network error'));

            const result = await adapter.save('test.txt', Buffer.from('test'));

            expect(result).toEqual({ ok: false, message: 'Network error' });
        });
    });
});
