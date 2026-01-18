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

import { initStorage } from 'src/modules/plugins/impl/rust-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/rust-plugin/utils/key-utils';

jest.mock('src/modules/plugins/impl/rust-plugin/utils/key-utils');

// Mock tar-stream to avoid complex parsing
jest.mock('tar-stream', () => ({
    extract: jest.fn(() => ({
        on: jest.fn((event, handler) => {
            if (event === 'finish') setTimeout(() => handler(), 0);
            return { on: jest.fn() };
        })
    }))
}));

// Mock zlib
jest.mock('zlib', () => ({
    createGunzip: jest.fn(() => ({
        on: jest.fn(),
        pipe: jest.fn(),
        end: jest.fn()
    }))
}));

// Mock toml parser
jest.mock('@iarna/toml', () => ({
    parse: jest.fn(() => ({
        package: { name: 'test', version: '1.0.0' },
        dependencies: {},
        features: {}
    }))
}));

const mockProxyFetch = jest.fn();
jest.mock('../../../../../plugins-core/proxy-helper', () => ({
    __esModule: true,
    default: mockProxyFetch
}), { virtual: true });

describe('RustPlugin Storage', () => {
    let context: any;
    let storageMethods: any;
    const repo: any = { id: 'r1', name: 'rust-repo', type: 'hosted' };

    beforeEach(() => {
        context = {
            storage: {
                save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
                get: jest.fn(),
                exists: jest.fn().mockResolvedValue(false),
                saveStream: jest.fn(),
                list: jest.fn()
            },
            indexArtifact: jest.fn(),
            getRepo: jest.fn()
        };
        storageMethods = initStorage(context);

        (keyUtils.buildKey as jest.Mock).mockImplementation((...args) => args.join('/'));
        mockProxyFetch.mockReset();
        jest.clearAllMocks();
    });

    describe('upload', () => {
        it('should save and index rust crate', async () => {
            const pkg = {
                name: 'serde',
                version: '1.0.0',
                content: Buffer.from('crate content'),
                deps: [],
                features: {}
            };

            const result = await storageMethods.upload(repo, pkg);

            expect(result.ok).toBe(true);
            expect(context.storage.save).toHaveBeenCalled();
            expect(context.indexArtifact).toHaveBeenCalled();
        });

        it('should handle base64 encoding', async () => {
            const pkg = {
                name: 'tokio',
                version: '1.0.0',
                content: Buffer.from('hello').toString('base64'),
                encoding: 'base64',
                deps: [],
                features: {}
            };
            const result = await storageMethods.upload(repo, pkg);
            expect(result.ok).toBe(true);
        });

        it('should block redeployment if disabled', async () => {
            const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
            context.storage.exists.mockResolvedValue(true);
            const result = await storageMethods.upload(repoNoRedeploy, {
                name: 'crate',
                version: '1.0.0',
                deps: [],
                features: {}
            });
            expect(result.ok).toBe(false);
            expect(result.message).toContain('Redeployment');
        });

        it('should handle storage errors', async () => {
            context.storage.save.mockRejectedValue(new Error('io'));
            const result = await storageMethods.upload(repo, {
                name: 'a',
                version: '1.0.0',
                deps: [],
                features: {}
            });
            expect(result.ok).toBe(false);
        });

        describe('group policies', () => {
            const groupRepo = { id: 'g1', type: 'group', config: { members: ['m1'] } };
            const m1 = { id: 'm1', type: 'hosted' };

            it('should handle first write policy', async () => {
                const firstRepo = { ...groupRepo, config: { members: ['m1'], writePolicy: 'first' } };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(firstRepo as any, {
                    name: 'crate',
                    version: '1.0.0',
                    deps: [],
                    features: {}
                });
                expect(result.ok).toBe(true);
            });

            it('should reject if writePolicy is none', async () => {
                const readOnlyRepo = { ...groupRepo, config: { writePolicy: 'none' } };
                const result = await storageMethods.upload(readOnlyRepo as any, { name: 'crate' });
                expect(result.ok).toBe(false);
                expect(result.message).toContain('read-only');
            });

            it('should handle preferred writer', async () => {
                const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred', preferredWriter: 'm1' } };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(prefRepo as any, {
                    name: 'crate',
                    version: '1.0.0',
                    deps: [],
                    features: {}
                });
                expect(result.ok).toBe(true);
            });

            it('should handle mirror write policy', async () => {
                const mirrorRepo = { ...groupRepo, config: { members: ['m1'], writePolicy: 'mirror' } };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(mirrorRepo as any, {
                    name: 'crate',
                    version: '1.0.0',
                    deps: [],
                    features: {}
                });
                expect(result.ok).toBe(true);
            });

            it('should handle missing preferred writer', async () => {
                const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred' } };
                const result = await storageMethods.upload(prefRepo as any, { name: 'c' });
                expect(result.ok).toBe(false);
            });
        });
    });

    describe('handlePut', () => {
        it('should handle PUT with buffer body', async () => {
            const result = await storageMethods.handlePut(repo, 'serde-1.0.0.crate', {
                body: Buffer.from('data')
            });
            expect(result.ok).toBe(true);
        });

        it('should parse crate name and version from filename', async () => {
            const result = await storageMethods.handlePut(repo, 'tokio-1.2.3.crate', { body: 'data' });
            expect(result.ok).toBe(true);
        });

        it('should handle stream body', async () => {
            const chunks = [Buffer.from('a'), Buffer.from('b')];
            const mockReq = {
                [Symbol.asyncIterator]: async function* () {
                    for (const chunk of chunks) yield chunk;
                }
            };
            const result = await storageMethods.handlePut(repo, 'crate-1.0.0.crate', mockReq);
            expect(result.ok).toBe(true);
        });
    });

    describe('download', () => {
        it('should download crate from storage', async () => {
            context.storage.get.mockResolvedValue(Buffer.from('crate data'));
            const result = await storageMethods.download(repo, 'serde', '1.0.0');
            expect(result.ok).toBe(true);
            expect(result.data).toBeDefined();
        });

        it('should return config.json for Cargo', async () => {
            const result = await storageMethods.download(repo, 'config.json');
            expect(result.ok).toBe(true);
            expect(result.contentType).toBe('application/json');
            const config = JSON.parse(result.data.toString());
            expect(config.dl).toBeDefined();
            expect(config.api).toBeDefined();
        });

        it('should download index file', async () => {
            context.storage.get.mockResolvedValue(Buffer.from('index data'));
            const result = await storageMethods.download(repo, 'se/rd/serde');
            expect(result.ok).toBe(true);
        });

        it('should handle group reading', async () => {
            const groupRepo = { type: 'group', config: { members: ['m1'] } };
            context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
            context.storage.get.mockResolvedValue(Buffer.from('data'));
            const result = await storageMethods.download(groupRepo as any, 'crate', '1.0.0');
            expect(result.ok).toBe(true);
        });

        it('should parse version from crates path', async () => {
            context.storage.get.mockResolvedValue(Buffer.from('data'));
            const result = await storageMethods.download(repo, 'crates/serde/1.0.0');
            expect(result.ok).toBe(true);
        });

        it('should fail if version missing', async () => {
            const result = await storageMethods.download(repo, 'serde');
            expect(result.ok).toBe(false);
        });

        it('should handle not found', async () => {
            context.storage.get.mockResolvedValue(null);
            const result = await storageMethods.download(repo, 'unknown', '1.0.0');
            expect(result.ok).toBe(false);
        });
    });

    describe('download (proxy)', () => {
        const proxyRepo = { id: 'p1', type: 'proxy', config: { url: 'https://crates.io' } };

        it('should return from cache if exists', async () => {
            context.storage.get.mockImplementation((key: string) => {
                if (key.includes('/proxy/')) return Promise.resolve(Buffer.from('cached'));
                return Promise.resolve(null);
            });
            const result = await storageMethods.download(proxyRepo as any, 'serde', '1.0.0');
            expect(result.ok).toBe(true);
            expect(result.data.toString()).toBe('cached');
        });

        it('should handle proxy fetch failure', async () => {
            context.storage.get.mockResolvedValue(null);
            mockProxyFetch.mockResolvedValue({ ok: false, message: 'not found' });

            const result = await storageMethods.download(proxyRepo as any, 'unknown', '1.0.0');
            expect(result.ok).toBe(false);
        });

        it('should handle missing upstream URL', async () => {
            const badProxyRepo = { id: 'p1', type: 'proxy', config: {} };
            const result = await storageMethods.download(badProxyRepo as any, 'serde', '1.0.0');
            expect(result.ok).toBe(false);
            expect(result.message).toContain('upstream');
        });
    });
});
