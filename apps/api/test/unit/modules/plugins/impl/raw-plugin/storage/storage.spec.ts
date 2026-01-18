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

import { initStorage } from 'src/modules/plugins/impl/raw-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/raw-plugin/utils/key-utils';

jest.mock('src/modules/plugins/impl/raw-plugin/utils/key-utils');

describe('RawPlugin Storage', () => {
  let context: any;
  let storageMethods: any;
  const repo: any = { id: 'r1', name: 'raw-repo', type: 'hosted' };

  beforeEach(() => {
    context = {
      storage: {
        save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
        get: jest.fn(),
        exists: jest.fn(),
        saveStream: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
        list: jest.fn()
      },
      indexArtifact: jest.fn(),
      getRepo: jest.fn()
    };
    storageMethods = initStorage(context);

    (keyUtils.buildKey as jest.Mock).mockImplementation((...args) => args.join('/'));
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('should save raw content', async () => {
      const result = await storageMethods.upload(repo, { name: 'file.txt', content: 'hello' });
      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalled();
    });

    it('should handle group write policies', async () => {
      const groupRepo = { id: 'g1', type: 'group', config: { members: ['m1'], writePolicy: 'first' } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      const result = await storageMethods.upload(groupRepo as any, { name: 'file.txt' });
      expect(result.ok).toBe(true);
    });

    it('should fail if group is read-only', async () => {
      const groupRepo = { type: 'group', config: { writePolicy: 'none' } };
      const result = await storageMethods.upload(groupRepo as any, { name: 'f' });
      expect(result.ok).toBe(false);
    });

    it('should handle mirror write failure', async () => {
      const groupRepo = { type: 'group', config: { members: ['m1'], writePolicy: 'mirror' } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      context.storage.save.mockRejectedValue(new Error('fail'));
      const result = await storageMethods.upload(groupRepo as any, { name: 'f' });
      expect(result.ok).toBe(false);
    });

    it('should handle storage error in upload', async () => {
      context.storage.save.mockRejectedValue(new Error('io'));
      const result = await storageMethods.upload(repo, { name: 'f' });
      expect(result.ok).toBe(false);
    });

    it('should block redeployment if disabled', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      context.storage.get.mockResolvedValue('exists');
      const result = await storageMethods.upload(repoNoRedeploy, { name: 'f' });
      expect(result.ok).toBe(false);
      expect(result.message).toContain('Redeployment');
    });
  });

  describe('handlePut', () => {
    it('should handle stream upload via saveStream', async () => {
      const result = await storageMethods.handlePut(repo, 'path/file.txt', {});
      expect(result.ok).toBe(true);
      expect(context.storage.saveStream).toHaveBeenCalled();
    });

    it('should handle stream upload via buffer if saveStream missing', async () => {
      context.storage.saveStream = undefined;
      const chunks = [Buffer.from('a'), Buffer.from('b')];
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk;
        }
      };
      const result = await storageMethods.handlePut(repo, 'path/file.txt', mockReq);
      expect(result.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalledWith(expect.any(String), Buffer.from('ab'));
    });

    it('should handle mirror write policy with stream buffering', async () => {
      const groupRepo = { id: 'g1', type: 'group', config: { members: ['m1'], writePolicy: 'mirror' } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted', config: {} });

      const chunks = [Buffer.from('data')];
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk;
        }
      };

      const result = await storageMethods.handlePut(groupRepo as any, 'f.txt', mockReq);
      expect(result.ok).toBe(true);
    });

    it('should handle buffer/object body', async () => {
      const r1 = await storageMethods.handlePut(repo, 'f1', { body: Buffer.from('b') });
      const r2 = await storageMethods.handlePut(repo, 'f2', { body: { json: true } });
      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);
      expect(context.storage.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('download', () => {
    it('should download from hosted', async () => {
      context.storage.get.mockResolvedValue(Buffer.from('data'));
      const result = await storageMethods.download(repo, 'file.txt');
      expect(result.ok).toBe(true);
      expect(result.data.toString()).toBe('data');
    });

    it('should handle group reading', async () => {
      const groupRepo = { type: 'group', config: { members: ['m1'] } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      context.storage.get.mockResolvedValue(Buffer.from('gdata'));
      const result = await storageMethods.download(groupRepo as any, 'f');
      expect(result.ok).toBe(true);
    });
  });

  describe('group policies edge cases', () => {
    const groupRepo = { id: 'g1', type: 'group', config: { members: ['m1'] } };

    it('should reject if writePolicy is none', async () => {
      const result = await storageMethods.handlePut({ ...groupRepo, config: { writePolicy: 'none' } } as any, 'f', {});
      expect(result.ok).toBe(false);
    });

    it('should handle preferred writer', async () => {
      const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred', preferredWriter: 'm1' } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      const result = await storageMethods.handlePut(prefRepo as any, 'f', { body: 'd' });
      expect(result.ok).toBe(true);
    });

    it('should handle missing preferred writer', async () => {
      const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred' } };
      const result = await storageMethods.handlePut(prefRepo as any, 'f', {});
      expect(result.ok).toBe(false);
    });

    it('should handle unavailable preferred writer', async () => {
      const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred', preferredWriter: 'm1' } };
      context.getRepo.mockResolvedValue(null);
      const result = await storageMethods.handlePut(prefRepo as any, 'f', {});
      expect(result.ok).toBe(false);
    });

    it('should handle first policy failures', async () => {
      const firstRepo = { ...groupRepo, config: { writePolicy: 'first' } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      context.storage.saveStream.mockRejectedValue(new Error('fail'));
      const result = await storageMethods.handlePut(firstRepo as any, 'f', {});
      expect(result.ok).toBe(false);
    });

    it('should block redeployment if exists by name', async () => {
      const repoNoRedeploy = { ...repo, config: { allowRedeploy: false } };
      context.storage.get.mockImplementation((key: string) => {
        if (key.includes('/raw-repo/')) return Promise.resolve('exists');
        return Promise.resolve(null);
      });
      const result = await storageMethods.handlePut(repoNoRedeploy, 'f', { body: 'd' });
      expect(result.ok).toBe(false);
    });

    it('should return error if not found in group', async () => {
      context.getRepo.mockResolvedValue(null);
      const result = await storageMethods.download(groupRepo as any, 'f');
      expect(result.ok).toBe(false);
    });
  });
});
