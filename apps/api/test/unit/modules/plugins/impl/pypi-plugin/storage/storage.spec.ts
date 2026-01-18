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

import { initStorage } from 'src/modules/plugins/impl/pypi-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/pypi-plugin/utils/key-utils';
import { proxyFetchWithAuth } from 'src/plugins-core/proxy-helper';

jest.mock('src/modules/plugins/impl/pypi-plugin/utils/key-utils');
jest.mock('src/plugins-core/proxy-helper', () => ({
    proxyFetchWithAuth: jest.fn(),
}));

describe('PyPIPlugin Storage', () => {
    let context: any;
    let storageMethods: any;
    const repo: any = { id: 'r1', name: 'pypi-repo', type: 'hosted' };

    beforeEach(() => {
        context = {
            storage: {
                save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
                get: jest.fn(),
                exists: jest.fn(),
                saveStream: jest.fn(),
                list: jest.fn(),
            },
            indexArtifact: jest.fn(),
            getRepo: jest.fn(),
        };
        storageMethods = initStorage(context);

        (keyUtils.buildKey as jest.Mock).mockImplementation((...args) =>
            args.join('/'),
        );
        jest.clearAllMocks();
    });

    describe('upload', () => {
        it('should save and index artifact', async () => {
            const pkg = {
                name: 'flask',
                version: '2.0.0',
                content: Buffer.from('content'),
            };

            const result = await storageMethods.upload(repo, pkg);

            expect(result.ok).toBe(true);
            expect(context.storage.save).toHaveBeenCalled();
            expect(context.indexArtifact).toHaveBeenCalledWith(
                repo,
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        name: 'flask',
                        version: '2.0.0',
                    }),
                }),
            );
        });

        it('should handle base64 encoding', async () => {
            const pkg = {
                name: 'pkg',
                version: '1.0',
                content: Buffer.from('hello').toString('base64'),
                encoding: 'base64',
            };
            const result = await storageMethods.upload(repo, pkg);
            expect(result.ok).toBe(true);
            expect(context.storage.save).toHaveBeenCalledWith(
                expect.any(String),
                Buffer.from('hello'),
            );
        });

        describe('group policies', () => {
            const groupRepo = {
                id: 'g1',
                type: 'group',
                config: { members: ['m1', 'm2'] },
            };
            const m1 = { id: 'm1', type: 'hosted' };

            it('should handle mirror write policy', async () => {
                const mirrorRepo = {
                    ...groupRepo,
                    config: { ...groupRepo.config, writePolicy: 'mirror' },
                };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(mirrorRepo, { name: 'pkg' });
                expect(result.ok).toBe(true);
            });

            it('should handle mirror policy failure', async () => {
                const mirrorRepo = {
                    ...groupRepo,
                    config: { ...groupRepo.config, writePolicy: 'mirror' },
                };
                context.getRepo.mockResolvedValue(m1);
                context.storage.save.mockRejectedValue(new Error('fail'));
                const result = await storageMethods.upload(mirrorRepo, { name: 'pkg' });
                expect(result.ok).toBe(false);
            });

            it('should reject if writePolicy is none', async () => {
                const readOnlyRepo = { ...groupRepo, config: { writePolicy: 'none' } };
                const result = await storageMethods.upload(readOnlyRepo, {
                    name: 'pkg',
                });
                expect(result.ok).toBe(false);
                expect(result.message).toContain('read-only');
            });

            it('should handle preferred writer', async () => {
                const prefRepo = {
                    ...groupRepo,
                    config: {
                        ...groupRepo.config,
                        writePolicy: 'preferred',
                        preferredWriter: 'm1',
                    },
                };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(prefRepo, { name: 'pkg' });
                expect(result.ok).toBe(true);
            });

            it('should handle missing preferred writer', async () => {
                const prefRepo = {
                    ...groupRepo,
                    config: { ...groupRepo.config, writePolicy: 'preferred' },
                };
                const result = await storageMethods.upload(prefRepo, { name: 'pkg' });
                expect(result.ok).toBe(false);
            });

            it('should handle unknown write policy', async () => {
                const badRepo = { ...groupRepo, config: { writePolicy: 'invalid' } };
                const result = await storageMethods.upload(badRepo, { name: 'p' });
                expect(result.ok).toBe(false);
            });

            it('should handle first policy loop', async () => {
                const firstRepo = {
                    ...groupRepo,
                    config: { ...groupRepo.config, writePolicy: 'first' },
                };
                context.getRepo.mockResolvedValue(m1);
                const result = await storageMethods.upload(firstRepo, { name: 'pkg' });
                expect(result.ok).toBe(true);
            });
        });

        it('should handle storage errors in upload', async () => {
            context.storage.save.mockRejectedValue(new Error('io'));
            const result = await storageMethods.upload(repo, { name: 'a' });
            expect(result.ok).toBe(false);
        });
    });

    describe('handlePut', () => {
        it('should handle put and index', async () => {
            const req = { body: Buffer.from('content') };
            // Path: /package/version/filename
            const path = 'flask/2.0.0/flask-2.0.0.tar.gz';

            const result = await storageMethods.handlePut(repo, path, req);

            expect(result.ok).toBe(true);
            expect(context.storage.save).toHaveBeenCalled();
            expect(context.indexArtifact).toHaveBeenCalled();
        });

        it('should handle iterable stream body', async () => {
            context.storage.saveStream = undefined; // Force buffer/iter path
            const chunks = [Buffer.from('part1'), Buffer.from('part2')];
            const mockReq = {
                [Symbol.asyncIterator]: async function* () {
                    for (const chunk of chunks) yield chunk;
                },
            };
            const result = await storageMethods.handlePut(
                repo,
                'pkg/1.0/f.tgz',
                mockReq,
            );
            expect(result.ok).toBe(true);
            expect(context.storage.save).toHaveBeenCalledWith(
                expect.any(String),
                Buffer.concat(chunks),
            );
        });

        it('should handle object body', async () => {
            const result = await storageMethods.handlePut(repo, 'p/1.0/f', {
                body: { complex: true },
            });
            expect(result.ok).toBe(true);
        });

        it('should block redeployment in handlePut', async () => {
            const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
            context.storage.exists.mockResolvedValue(true);
            const result = await storageMethods.handlePut(repoNoRedeploy, 'a/b/c', {
                body: 'data',
            });
            expect(result.ok).toBe(false);
        });
        it('should parse various path lengths', async () => {
            await storageMethods.handlePut(repo, 'only-name', { body: 'data' });
            await storageMethods.handlePut(repo, 'name/version', { body: 'data' });
            expect(context.storage.save).toHaveBeenCalledTimes(2);
        });

        it('should use saveStream if available', async () => {
            context.storage.saveStream.mockResolvedValue({ size: 10 });
            const result = await storageMethods.handlePut(repo, 'a/b/c', {});
            expect(context.storage.saveStream).toHaveBeenCalled();
            expect(result.ok).toBe(true);
        });
    });

    describe('download', () => {
        it('should download artifact from storage', async () => {
            context.storage.get.mockResolvedValue(Buffer.from('content'));
            const result = await storageMethods.download(
                repo,
                'flask/2.0.0/flask-2.0.0.tar.gz',
                '2.0.0',
            );
            expect(result.ok).toBe(true);
            expect(result.data).toBeDefined();
        });

        it('should parse version from path if missing', async () => {
            context.storage.get.mockResolvedValue(Buffer.from('c'));
            const result = await storageMethods.download(repo, 'flask/2.0.0');
            expect(result.ok).toBe(true);
        });

        it('should list and pick preferred format if exact match fails', async () => {
            context.storage.get.mockResolvedValue(null);
            context.storage.list.mockResolvedValue([
                'pypi/r1/flask/2.0.0/flask-2.0.0.tar.gz',
                'pypi/r1/flask/2.0.0/flask-2.0.0-py3-none-any.whl',
            ]);

            context.storage.get.mockImplementation((key: string) => {
                if (key.endsWith('.whl')) return Buffer.from('whl content');
                return null;
            });

            const result = await storageMethods.download(repo, 'flask', '2.0.0');
            expect(result.ok).toBe(true);
            expect(result.data.toString()).toBe('whl content');
        });

        it('should fail if not found', async () => {
            context.storage.get.mockResolvedValue(null);
            context.storage.list.mockResolvedValue([]);

            const result = await storageMethods.download(repo, 'unknown', '1.0');
            expect(result.ok).toBe(false);
        });

        it('should delegate to group members', async () => {
            const groupRepo = { type: 'group', config: { members: ['m1'] } };
            context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
            context.storage.get.mockResolvedValue(Buffer.from('c'));
            const result = await storageMethods.download(
                groupRepo as any,
                'pkg',
                '1.0',
            );
            expect(result.ok).toBe(true);
        });

        it('should return error if not found in group', async () => {
            const groupRepo = { type: 'group', config: { members: ['m1'] } };
            context.getRepo.mockResolvedValue(null);
            const result = await storageMethods.download(
                groupRepo as any,
                'pkg',
                '1.0',
            );
            expect(result.ok).toBe(false);
        });

        it('should return error if version missing and not in path', async () => {
            const result = await storageMethods.download(repo, 'onlyname');
            expect(result.ok).toBe(false);
        });
    });

    describe('download (proxy)', () => {
        const proxyRepo: any = {
            ...repo,
            type: 'proxy',
            config: { url: 'https://pypi.org' },
        };

        it('should return from cache if exists', async () => {
            context.storage.get.mockImplementation((key: string) => {
                if (key.includes('/proxy/'))
                    return Promise.resolve(Buffer.from('cached'));
                return Promise.resolve(null);
            });
            const result = await storageMethods.download(proxyRepo, 'flask', '2.0.0');
            expect(result.ok).toBe(true);
            expect(result.data.toString()).toBe('cached');
        });

        it('should fetch from upstream if cache miss and index it', async () => {
            context.storage.get.mockResolvedValue(null);

            (proxyFetchWithAuth as jest.Mock).mockResolvedValue({
                ok: true,
                body: Buffer.from('upstream content'),
                headers: {},
            });

            const result = await storageMethods.download(proxyRepo, 'flask', '2.0.0');

            expect(result.ok).toBe(true);
            expect(result.skipCache).toBe(true);
            expect(context.storage.save).toHaveBeenCalled();
            expect(context.indexArtifact).toHaveBeenCalledWith(
                proxyRepo,
                expect.objectContaining({
                    metadata: expect.objectContaining({
                        name: 'flask',
                        version: '2.0.0',
                    }),
                }),
            );
        });

        it('should ignore indexing errors in proxy download', async () => {
            context.storage.get.mockResolvedValue(null);
            (proxyFetchWithAuth as jest.Mock).mockResolvedValue({
                ok: true,
                body: Buffer.from('c'),
                headers: {},
            });
            context.indexArtifact.mockRejectedValue(new Error('index fail'));

            const result = await storageMethods.download(proxyRepo, 'flask', '2.0.0');
            expect(result.ok).toBe(true);
        });
    });

    describe('redeployment', () => {
        it('should block redeployment if disabled', async () => {
            const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
            context.storage.get.mockResolvedValue('exists'); // simulate existing ID key

            const pkg = { name: 'pkg', version: '1.0', content: 'c' };
            const result = await storageMethods.upload(repoNoRedeploy, pkg);

            expect(result.ok).toBe(false);
            expect(result.message).toContain('Redeployment');
        });
    });
});
