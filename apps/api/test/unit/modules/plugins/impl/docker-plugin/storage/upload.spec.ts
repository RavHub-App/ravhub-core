/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

import {
  initUpload,
  initiateUpload,
  appendUpload,
  finalizeUpload,
} from 'src/modules/plugins/impl/docker-plugin/storage/upload';
import { Repository } from 'src/modules/plugins/impl/docker-plugin/utils/types';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { Readable } from 'stream';
import { uploadTargets } from 'src/modules/plugins/impl/docker-plugin/utils/helpers';

jest.mock('stream/promises', () => ({
  pipeline: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  createWriteStream: jest.fn(),
  createReadStream: jest.fn(),
  writeFileSync: jest.fn(),
  appendFileSync: jest.fn(),
  statSync: jest.fn(),
  unlinkSync: jest.fn(),
  promises: {
    stat: jest.fn(),
    unlink: jest.fn(),
  },
}));

jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

jest.mock('src/modules/plugins/impl/docker-plugin/utils/helpers', () => ({
  uploadTargets: new Map(),
}));

describe('DockerPlugin Upload Storage', () => {
  let mockStorage: any;
  let mockGetRepo: any;
  let mockRedis: any;

  beforeEach(() => {
    mockStorage = {
      save: jest
        .fn()
        .mockResolvedValue({ size: 100, contentHash: 'sha256:abc' }),
      saveStream: jest
        .fn()
        .mockResolvedValue({ size: 100, contentHash: 'sha256:abc' }),
    };
    mockGetRepo = jest.fn();
    mockRedis = {
      isEnabled: jest.fn().mockReturnValue(false), // Default to memory/file mode
    };

    // Reset fs mocks
    (fs.existsSync as jest.Mock).mockReturnValue(false);
    (fs.createWriteStream as jest.Mock).mockReturnValue({
      write: jest.fn().mockReturnValue(true),
      end: jest.fn(),
      on: jest.fn((event, cb) => {
        if (event === 'finish') cb();
      }),
      once: jest.fn(),
      emit: jest.fn(),
    });
    (fs.statSync as jest.Mock).mockReturnValue({ size: 100 });

    initUpload({
      storage: mockStorage,
      getRepo: mockGetRepo,
      redis: mockRedis,
    });
    uploadTargets.clear();
    jest.clearAllMocks();
  });

  describe('initiateUpload', () => {
    const repo: Repository = { id: 'r1', type: 'hosted', config: {} } as any;

    it('should return uuid for hosted repo', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true); // Temp dir exists
      const result = await initiateUpload(repo, 'image');
      expect(result.ok).toBe(true);
      expect(result.uuid).toBeDefined();
    });

    it('should reject proxy repo', async () => {
      const result = await initiateUpload(
        { ...repo, type: 'proxy' } as any,
        'image',
      );
      expect(result.ok).toBe(false);
    });

    // Group logic tests
    it('should handle group writePolicy none', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'none' },
      };
      const result = await initiateUpload(groupRepo as any, 'img');
      expect(result.ok).toBe(false);
      expect(result.message).toContain('none');
    });

    it('should handle group writePolicy first', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'first', members: ['m1'] },
      };
      const member = { id: 'm1', type: 'hosted' };
      mockGetRepo.mockResolvedValue(member);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await initiateUpload(groupRepo as any, 'img');
      expect(result.ok).toBe(true);
      expect(mockGetRepo).toHaveBeenCalledWith('m1');
    });

    it('should handle group writePolicy preferred', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: {
          writePolicy: 'preferred',
          preferredWriter: 'm1',
          members: ['m1'],
        },
      };
      const member = { id: 'm1', type: 'hosted' };
      mockGetRepo.mockResolvedValue(member);
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await initiateUpload(groupRepo as any, 'img');
      expect(result.ok).toBe(true);
    });

    it('should handle group writePolicy mirror across hosted members', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { writePolicy: 'mirror', members: ['m1', 'm2'] },
      };
      mockGetRepo.mockImplementation(async (id: string) => ({
        id,
        type: 'hosted',
        config: {},
      }));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await initiateUpload(groupRepo as any, 'img');

      expect(result.ok).toBe(true);
      expect(result.uuid).toBeDefined();
      expect(uploadTargets.get(result.uuid)).toMatchObject({
        groupId: 'g1',
        policy: 'mirror',
      });
      expect(uploadTargets.get(result.uuid)?.targets).toHaveLength(2);
    });

    it('should handle group writePolicy broadcast across hosted members', async () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: {
          writePolicy: 'broadcast',
          preferredWriter: 'm1',
          members: ['m1', 'm2'],
        },
      };
      mockGetRepo.mockImplementation(async (id: string) => ({
        id,
        type: 'hosted',
        config: {},
      }));
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await initiateUpload(groupRepo as any, 'img');

      expect(result.ok).toBe(true);
      expect(result.uuid).toBeDefined();
      expect(uploadTargets.get(result.uuid)).toMatchObject({
        groupId: 'g1',
        policy: 'broadcast',
      });
      expect(uploadTargets.get(result.uuid)?.targets).toHaveLength(2);
    });

    it('should reject unsupported group writePolicy instead of falling back to hosted', async () => {
      const result = await initiateUpload(
        {
          id: 'g1',
          type: 'group',
          config: { writePolicy: 'unknown', members: ['m1'] },
        } as any,
        'img',
      );

      expect(result.ok).toBe(false);
      expect(result.message).toContain('unsupported writePolicy');
    });
  });

  describe('Redis integration', () => {
    it('should use redis if enabled', async () => {
      mockRedis.isEnabled.mockReturnValue(true);
      mockRedis.get = jest.fn().mockResolvedValue(null);
      mockRedis.set = jest.fn().mockResolvedValue('OK');
      mockRedis.del = jest.fn().mockResolvedValue(1);

      const repo = { id: 'r1', type: 'hosted' };
      await initiateUpload(repo as any, 'img');
      expect(mockRedis.set).toHaveBeenCalled();
    });
  });

  describe('appendUpload', () => {
    it('should append chunk to file', async () => {
      const uuid = 'u-123';
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const repo: Repository = { id: 'r1', type: 'hosted', config: {} } as any;
      const chunk = Buffer.from('data');
      const result = await appendUpload(repo, uuid, undefined, chunk);
      expect(result.ok).toBe(true);
      expect(fs.appendFileSync).toHaveBeenCalled();
    });

    it('should handle streaming append', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockStream: any = { pipe: jest.fn(), on: jest.fn() };
      const result = await appendUpload(
        { id: 'r1' } as any,
        'u1',
        undefined,
        undefined,
        mockStream,
      );
      expect(result.ok).toBe(true);
    });

    it('should return error if session missing', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(false);
      const result = await appendUpload(
        { id: 'r1' } as any,
        'u1',
        undefined,
        Buffer.from('data'),
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain('not found');
    });

    it('should delegate group stream uploads as buffered content', async () => {
      uploadTargets.set('group-uuid', {
        groupId: 'g1',
        targets: [{ repoId: 'm1', uuid: 'child-uuid' }],
        policy: 'first',
      });
      mockGetRepo.mockResolvedValue({ id: 'm1', type: 'hosted', config: {} });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const result = await appendUpload(
        { id: 'g1', type: 'group', config: {} } as any,
        'group-uuid',
        undefined,
        undefined,
        Readable.from([Buffer.from('abc'), Buffer.from('def')]),
      );

      expect(result.ok).toBe(true);
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        Buffer.from('abcdef'),
      );
    });
  });

  describe('finalizeUpload', () => {
    const repo = { id: 'r1', type: 'hosted' };
    const contentBuffer = Buffer.from('content');
    const contentDigest = `sha256:${crypto.createHash('sha256').update(contentBuffer).digest('hex')}`;

    it('should finalize with provided digest', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockReadStream: any = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(contentBuffer);
          if (event === 'end') cb();
          return mockReadStream;
        }),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
      const result = await finalizeUpload(
        repo as any,
        'img',
        'uuid',
        contentDigest,
      );
      expect(result.ok).toBe(true);
      expect(result.id).toBe(contentDigest);
    });

    it('should calculate digest if not provided', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockReadStream: any = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(contentBuffer);
          if (event === 'end') cb();
          return mockReadStream;
        }),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);

      const result = await finalizeUpload(
        repo as any,
        'img',
        'uuid',
        undefined,
      );
      expect(result.ok).toBe(true);
      expect(result.id).toContain('sha256:');
    });

    it('should handle storage errors', async () => {
      (fs.existsSync as jest.Mock).mockReturnValue(true);
      const mockReadStream: any = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(contentBuffer);
          if (event === 'end') cb();
          return mockReadStream;
        }),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);
      mockStorage.saveStream.mockRejectedValue(new Error('save-fail'));

      const result = await finalizeUpload(
        repo as any,
        'img',
        'uuid',
        contentDigest,
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain('save-fail');
    });

    it('should delegate group finalize stream uploads as buffered content', async () => {
      uploadTargets.set('group-uuid', {
        groupId: 'g1',
        targets: [{ repoId: 'm1', uuid: 'child-uuid' }],
        policy: 'first',
      });
      mockGetRepo.mockResolvedValue({ id: 'm1', type: 'hosted', config: {} });
      (fs.existsSync as jest.Mock).mockReturnValue(true);

      const mockReadStream: any = {
        on: jest.fn((event, cb) => {
          if (event === 'data') cb(contentBuffer);
          if (event === 'end') cb();
          return mockReadStream;
        }),
      };
      (fs.createReadStream as jest.Mock).mockReturnValue(mockReadStream);

      const result = await finalizeUpload(
        { id: 'g1', type: 'group', config: {} } as any,
        'img',
        'group-uuid',
        undefined,
        undefined,
        Readable.from([contentBuffer]),
      );

      expect(result.ok).toBe(true);
      expect(fs.appendFileSync).toHaveBeenCalledWith(
        expect.any(String),
        contentBuffer,
      );
    });
  });
});
