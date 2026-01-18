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

import { UpstreamPingService } from 'src/modules/plugins/upstream-ping.service';
import AppDataSource from 'src/data-source';

jest.mock('src/data-source', () => ({
  __esModule: true,
  default: {
    isInitialized: true,
    getRepository: jest.fn(),
  },
}));

describe('UpstreamPingService (Unit)', () => {
  let service: UpstreamPingService;
  let mockRepoRepo: any;

  beforeEach(() => {
    mockRepoRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
    };
    (AppDataSource.getRepository as jest.Mock).mockReturnValue(mockRepoRepo);

    service = new UpstreamPingService();
  });

  describe('pingUpstreamForRepo', () => {
    it('should ping upstream successfully', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      };
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        config: { target: 'http://upstream.example.com' },
      };

      const result = await service.pingUpstreamForRepo(repo as any, mockPlugin);

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(mockPlugin.pingUpstream).toHaveBeenCalledWith(repo);
    });

    it('should return error if plugin does not support ping', async () => {
      const repo = { id: 'repo1', name: 'test-repo' };

      const result = await service.pingUpstreamForRepo(repo as any, null);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('does not support');
    });

    it('should return error if no upstream URL configured', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn(),
      };
      const repo = { id: 'repo1', name: 'test-repo', config: {} };

      const result = await service.pingUpstreamForRepo(repo as any, mockPlugin);

      expect(result.ok).toBe(false);
      expect(result.message).toContain('No upstream URL');
    });

    it('should handle ping errors gracefully', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn().mockRejectedValue(new Error('Network error')),
      };
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        config: { target: 'http://upstream.example.com' },
      };

      const result = await service.pingUpstreamForRepo(repo as any, mockPlugin);

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Network error');
    });

    it('should store ping status in cache', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      };
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        config: { target: 'http://upstream.example.com' },
      };

      await service.pingUpstreamForRepo(repo as any, mockPlugin);

      const status = await service.getUpstreamPingStatus('repo1');
      expect(status).toBeDefined();
      expect(status?.ok).toBe(true);
      expect(status?.status).toBe(200);
    });
  });

  describe('getUpstreamPingStatus', () => {
    it('should return cached ping status', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      };
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        config: { target: 'http://upstream.example.com' },
      };

      await service.pingUpstreamForRepo(repo as any, mockPlugin);
      const status = await service.getUpstreamPingStatus('repo1');

      expect(status).toBeDefined();
      expect(status?.ok).toBe(true);
    });

    it('should return null for non-existent status in cache and DB', async () => {
      mockRepoRepo.findOne.mockResolvedValue(null);
      const status = await service.getUpstreamPingStatus('non-existent');
      expect(status).toBeNull();
    });

    it('should lookup repository in DB if not in cache', async () => {
      const repo = { id: 'repo1', name: 'test-repo' };
      mockRepoRepo.findOne.mockResolvedValue(repo);

      // Populate cache for ID
      const status = { ts: Date.now(), ok: true, status: 200 };
      (service as any).upstreamPingStatus.set('repo1', status);

      // Query by name, should lookup ID from DB then find in cache
      const result = await service.getUpstreamPingStatus('test-repo');

      expect(mockRepoRepo.findOne).toHaveBeenCalledWith({
        where: [{ id: 'test-repo' }, { name: 'test-repo' }],
      });
      expect(result).toBe(status);
    });
  });

  describe('triggerUpstreamPingForRepo', () => {
    it('should trigger ping and return status', async () => {
      const mockPlugin = {
        pingUpstream: jest.fn().mockResolvedValue({ ok: true, status: 200 }),
      };
      const repo = {
        id: 'repo1',
        name: 'test-repo',
        config: { target: 'http://upstream.example.com' },
      };

      const result = await service.triggerUpstreamPingForRepo(
        repo as any,
        mockPlugin,
      );

      expect(result.ok).toBe(true);
      expect(mockPlugin.pingUpstream).toHaveBeenCalled();
    });

    it('should return error if plugin does not support ping', async () => {
      const repo = { id: 'repo1', name: 'test-repo' };

      const result = await service.triggerUpstreamPingForRepo(
        repo as any,
        null,
      );

      expect(result.ok).toBe(false);
    });
  });
});
