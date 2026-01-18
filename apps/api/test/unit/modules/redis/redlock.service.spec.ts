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

import { RedlockService } from 'src/modules/redis/redlock.service';
import { RedisService } from 'src/modules/redis/redis.service';

describe('RedlockService (Unit)', () => {
  let service: RedlockService;
  let redisService: jest.Mocked<RedisService>;

  beforeEach(() => {
    redisService = {
      isEnabled: jest.fn(),
      getClient: jest.fn(),
    } as any;
    service = new RedlockService(redisService);
  });

  describe('onModuleInit', () => {
    it('should not initialize if Redis is disabled', () => {
      redisService.isEnabled.mockReturnValue(false);
      service.onModuleInit();
      expect(redisService.getClient).not.toHaveBeenCalled();
    });

    it('should initialize redlock if Redis is enabled', () => {
      const mockClient = { on: jest.fn() };
      redisService.isEnabled.mockReturnValue(true);
      redisService.getClient.mockReturnValue(mockClient as any);

      service.onModuleInit();
      expect(redisService.getClient).toHaveBeenCalled();
    });

    it('should not initialize if client is null', () => {
      redisService.isEnabled.mockReturnValue(true);
      redisService.getClient.mockReturnValue(null);

      service.onModuleInit();
      expect((service as any).redlock).toBeNull();
    });
  });

  describe('runWithLock (in-memory fallback)', () => {
    it('should execute function with in-memory lock when Redis is disabled', async () => {
      redisService.isEnabled.mockReturnValue(false);
      service.onModuleInit();

      const fn = jest.fn().mockResolvedValue('result');
      const result = await service.runWithLock('test-resource', 5000, fn);

      expect(result).toBe('result');
      expect(fn).toHaveBeenCalled();
    });

    it('should serialize concurrent calls with in-memory lock', async () => {
      redisService.isEnabled.mockReturnValue(false);
      service.onModuleInit();

      const order: number[] = [];
      const fn1 = async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        order.push(1);
        return 'first';
      };
      const fn2 = async () => {
        order.push(2);
        return 'second';
      };

      const [res1, res2] = await Promise.all([
        service.runWithLock('resource', 5000, fn1),
        service.runWithLock('resource', 5000, fn2),
      ]);

      expect(res1).toBe('first');
      expect(res2).toBe('second');
      expect(order).toEqual([1, 2]);
    });

    it('should release lock even if function throws', async () => {
      redisService.isEnabled.mockReturnValue(false);
      service.onModuleInit();

      const fn = jest.fn().mockRejectedValue(new Error('test error'));

      await expect(service.runWithLock('resource', 5000, fn)).rejects.toThrow(
        'test error',
      );

      // Verify lock is released by running another function
      const fn2 = jest.fn().mockResolvedValue('ok');
      await service.runWithLock('resource', 5000, fn2);
      expect(fn2).toHaveBeenCalled();
    });
  });

  describe('lock', () => {
    it('should return null if redlock is not initialized', async () => {
      const result = await service.lock('resource', 5000);
      expect(result).toBeNull();
    });

    it('should acquire lock if redlock is initialized', async () => {
      const mockLock = { release: jest.fn() };
      const mockRedlock = {
        acquire: jest.fn().mockResolvedValue(mockLock),
        on: jest.fn(),
      };
      (service as any).redlock = mockRedlock;

      const result = await service.lock('resource', 5000);
      expect(result).toBe(mockLock);
      expect(mockRedlock.acquire).toHaveBeenCalledWith(['resource'], 5000);
    });
  });

  describe('runWithLock (with Redis)', () => {
    it('should execute function with Redis lock', async () => {
      const mockLock = { release: jest.fn().mockResolvedValue(undefined) };
      const mockRedlock = {
        acquire: jest.fn().mockResolvedValue(mockLock),
        on: jest.fn(),
      };
      (service as any).redlock = mockRedlock;

      const fn = jest.fn().mockResolvedValue('result');
      const result = await service.runWithLock('resource', 5000, fn);

      expect(result).toBe('result');
      expect(mockRedlock.acquire).toHaveBeenCalledWith(['resource'], 5000);
      expect(mockLock.release).toHaveBeenCalled();
    });

    it('should release lock even if function throws', async () => {
      const mockLock = { release: jest.fn().mockResolvedValue(undefined) };
      const mockRedlock = {
        acquire: jest.fn().mockResolvedValue(mockLock),
        on: jest.fn(),
      };
      (service as any).redlock = mockRedlock;

      const fn = jest.fn().mockRejectedValue(new Error('test error'));

      await expect(service.runWithLock('resource', 5000, fn)).rejects.toThrow(
        'test error',
      );
      expect(mockLock.release).toHaveBeenCalled();
    });
  });
});
