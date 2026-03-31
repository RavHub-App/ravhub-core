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

import { initStorage } from 'src/modules/plugins/impl/rust-plugin/storage/storage';
import * as keyUtils from 'src/modules/plugins/impl/rust-plugin/utils/key-utils';

jest.mock('src/modules/plugins/impl/rust-plugin/utils/key-utils');

// Mock tar-stream to avoid complex parsing
jest.mock('tar-stream', () => ({
  extract: jest.fn(() => ({
    on: jest.fn((event, handler) => {
      if (event === 'finish') setTimeout(() => handler(), 0);
      return { on: jest.fn() };
    }),
  })),
}));

// Mock zlib
jest.mock('zlib', () => ({
  createGunzip: jest.fn(() => ({
    on: jest.fn(),
    pipe: jest.fn(),
    end: jest.fn(),
  })),
}));

// Mock toml parser
jest.mock('@iarna/toml', () => ({
  parse: jest.fn(() => ({
    package: { name: 'test', version: '1.0.0' },
    dependencies: {},
    features: {},
  })),
}));

const mockProxyFetch = jest.fn();
jest.mock('src/plugins-core/proxy-helper', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockProxyFetch(...args),
}));

describe('RustPlugin Storage', () => {
  let context: any;
  let storageMethods: any;
  const repo: any = { id: 'r1', name: 'rust-repo', type: 'hosted' };
  let proxyHelperModule: { default?: unknown };

  beforeEach(() => {
    proxyHelperModule = require('src/plugins-core/proxy-helper');
    context = {
      storage: {
        save: jest.fn().mockResolvedValue({ size: 100, contentHash: 'abc' }),
        get: jest.fn(),
        exists: jest.fn().mockResolvedValue(false),
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
    mockProxyFetch.mockReset();
    mockProxyFetch.mockResolvedValue({
      ok: true,
      body: Buffer.from('crate-data'),
    });
    proxyHelperModule.default = mockProxyFetch;
    jest.clearAllMocks();
  });

  describe('upload', () => {
    it('should save and index rust crate', async () => {
      const pkg = {
        name: 'serde',
        version: '1.0.0',
        content: Buffer.from('crate content'),
        deps: [],
        features: {},
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
        features: {},
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
        features: {},
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
        features: {},
      });
      expect(result.ok).toBe(false);
    });

    it('should regenerate index when reading existing index fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      context.storage.get.mockRejectedValue(new Error('index-read-fail'));

      const result = await storageMethods.upload(repo, {
        name: 'serde',
        version: '1.0.0',
        content: Buffer.from('crate content'),
        deps: [],
        features: {},
      });

      expect(result.ok).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Failed to read existing index for serde: Error: index-read-fail',
      );
      warnSpy.mockRestore();
    });

    it('should continue upload when crate metadata unpacking fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const { createGunzip } = require('zlib');
      createGunzip.mockImplementationOnce(() => {
        throw new Error('gunzip-fail');
      });

      const result = await storageMethods.upload(repo, {
        name: 'serde',
        version: '1.0.0',
        content: Buffer.from('crate content'),
      });

      expect(result.ok).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Failed to unpack crate metadata: Error: gunzip-fail',
      );
      warnSpy.mockRestore();
    });

    it('should continue upload when Cargo.toml parsing fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const tarStream = require('tar-stream');
      const toml = require('@iarna/toml');

      tarStream.extract.mockImplementationOnce(() => {
        const handlers: Record<string, (...args: any[]) => void> = {};
        return {
          on: jest.fn((event, handler) => {
            handlers[event] = handler;
            return this;
          }),
        };
      });

      const { createGunzip } = require('zlib');
      createGunzip.mockImplementationOnce(() => ({
        on: jest.fn(),
        pipe: jest.fn(),
        end: jest.fn(() => {
          const extract = tarStream.extract.mock.results.at(-1)?.value;
          const entryHandler = extract.on.mock.calls.find(
            ([event]: [string]) => event === 'entry',
          )?.[1];
          const finishHandler = extract.on.mock.calls.find(
            ([event]: [string]) => event === 'finish',
          )?.[1];
          const streamHandlers: Record<string, (...args: any[]) => void> = {};
          const stream = {
            on: jest.fn((event, handler) => {
              streamHandlers[event] = handler;
              return stream;
            }),
            resume: jest.fn(),
          };

          toml.parse.mockImplementationOnce(() => {
            throw new Error('toml-fail');
          });

          entryHandler?.({ name: 'serde-1.0.0/Cargo.toml' }, stream, () =>
            finishHandler?.(),
          );
          streamHandlers.data?.(Buffer.from('broken = ['));
          streamHandlers.end?.();
        }),
      }));

      const result = await storageMethods.upload(repo, {
        name: 'serde',
        version: '1.0.0',
        content: Buffer.from('crate content'),
      });

      expect(result.ok).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Failed to parse Cargo.toml metadata: Error: toml-fail',
      );
      warnSpy.mockRestore();
    });

    describe('group policies', () => {
      const groupRepo = {
        id: 'g1',
        type: 'group',
        config: { members: ['m1'] },
      };
      const m1 = { id: 'm1', type: 'hosted' };

      it('should handle first write policy', async () => {
        const firstRepo = {
          ...groupRepo,
          config: { members: ['m1'], writePolicy: 'first' },
        };
        context.getRepo.mockResolvedValue(m1);
        const result = await storageMethods.upload(firstRepo as any, {
          name: 'crate',
          version: '1.0.0',
          deps: [],
          features: {},
        });
        expect(result.ok).toBe(true);
      });

      it('should reject if writePolicy is none', async () => {
        const readOnlyRepo = { ...groupRepo, config: { writePolicy: 'none' } };
        const result = await storageMethods.upload(readOnlyRepo as any, {
          name: 'crate',
        });
        expect(result.ok).toBe(false);
        expect(result.message).toContain('read-only');
      });

      it('should handle preferred writer', async () => {
        const prefRepo = {
          ...groupRepo,
          config: { writePolicy: 'preferred', preferredWriter: 'm1' },
        };
        context.getRepo.mockResolvedValue(m1);
        const result = await storageMethods.upload(prefRepo as any, {
          name: 'crate',
          version: '1.0.0',
          deps: [],
          features: {},
        });
        expect(result.ok).toBe(true);
      });

      it('should handle mirror write policy', async () => {
        const mirrorRepo = {
          ...groupRepo,
          config: { members: ['m1'], writePolicy: 'mirror' },
        };
        context.getRepo.mockResolvedValue(m1);
        const result = await storageMethods.upload(mirrorRepo as any, {
          name: 'crate',
          version: '1.0.0',
          deps: [],
          features: {},
        });
        expect(result.ok).toBe(true);
      });

      it('should handle missing preferred writer', async () => {
        const prefRepo = { ...groupRepo, config: { writePolicy: 'preferred' } };
        const result = await storageMethods.upload(prefRepo as any, {
          name: 'c',
        });
        expect(result.ok).toBe(false);
      });
    });
  });

  describe('handlePut', () => {
    it('should handle PUT with buffer body', async () => {
      const result = await storageMethods.handlePut(repo, 'serde-1.0.0.crate', {
        body: Buffer.from('data'),
      });
      expect(result.ok).toBe(true);
    });

    it('should parse crate name and version from filename', async () => {
      const result = await storageMethods.handlePut(repo, 'tokio-1.2.3.crate', {
        body: 'data',
      });
      expect(result.ok).toBe(true);
    });

    it('should handle stream body', async () => {
      const chunks = [Buffer.from('a'), Buffer.from('b')];
      const mockReq = {
        [Symbol.asyncIterator]: async function* () {
          for (const chunk of chunks) yield chunk;
        },
      };
      const result = await storageMethods.handlePut(
        repo,
        'crate-1.0.0.crate',
        mockReq,
      );
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

    it('should encode repository names in config.json endpoints', async () => {
      const result = await storageMethods.download(
        { ...repo, name: 'rust repo#beta' },
        'config.json',
      );
      expect(result.ok).toBe(true);
      const config = JSON.parse(result.data.toString());
      expect(config.dl).toBe(
        'http://localhost:3000/repository/rust%20repo%23beta/crates/{crate}/{version}/download',
      );
      expect(config.api).toBe(
        'http://localhost:3000/repository/rust%20repo%23beta',
      );
    });

    it('should download index file', async () => {
      context.storage.get.mockResolvedValue(Buffer.from('index data'));
      const result = await storageMethods.download(repo, 'se/rd/serde');
      expect(result.ok).toBe(true);
    });

    it('should warn and return version required when index read fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      context.storage.get.mockRejectedValue(new Error('index-read-fail'));

      const result = await storageMethods.download(repo, 'se/rd/serde');

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Not found');
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Failed to read index path se/rd/serde: Error: index-read-fail',
      );
      warnSpy.mockRestore();
    });

    it('should handle group reading', async () => {
      const groupRepo = { type: 'group', config: { members: ['m1'] } };
      context.getRepo.mockResolvedValue({ id: 'm1', type: 'hosted' });
      context.storage.get.mockResolvedValue(Buffer.from('data'));
      const result = await storageMethods.download(
        groupRepo as any,
        'crate',
        '1.0.0',
      );
      expect(result.ok).toBe(true);
    });

    it('should continue group reading when one member throws', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      const groupRepo = {
        type: 'group',
        config: { members: ['broken', 'm1'] },
      };
      context.getRepo.mockImplementation(async (id: string) => {
        if (id === 'broken') throw new Error('member-fail');
        if (id === 'm1') return { id: 'm1', type: 'hosted' };
        return null;
      });
      context.storage.get.mockResolvedValue(Buffer.from('data'));

      const result = await storageMethods.download(
        groupRepo as any,
        'crate',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Group download failed for member broken: Error: member-fail',
      );
      warnSpy.mockRestore();
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
    const proxyRepo = {
      id: 'p1',
      type: 'proxy',
      config: { url: 'https://crates.io' },
    };

    it('should return from cache if exists', async () => {
      context.storage.get.mockImplementation((key: string) => {
        if (key.includes('/proxy/'))
          return Promise.resolve(Buffer.from('cached'));
        return Promise.resolve(null);
      });
      const result = await storageMethods.download(
        proxyRepo as any,
        'serde',
        '1.0.0',
      );
      expect(result.ok).toBe(true);
      expect(result.data.toString()).toBe('cached');
    });

    it('should handle proxy fetch failure', async () => {
      context.storage.get.mockResolvedValue(null);
      mockProxyFetch.mockResolvedValue({ ok: false, message: 'not found' });

      const result = await storageMethods.download(
        proxyRepo as any,
        'unknown',
        '1.0.0',
      );
      expect(result.ok).toBe(false);
    });

    it('should return proxied crate when proxy indexing fails', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      context.storage.get.mockResolvedValue(null);
      context.indexArtifact.mockRejectedValue(new Error('index-fail'));
      mockProxyFetch.mockResolvedValue({
        ok: true,
        body: Buffer.from('crate-data'),
      });

      const result = await storageMethods.download(
        proxyRepo as any,
        'serde',
        '1.0.0',
      );

      expect(result.ok).toBe(true);
      expect(result.data.toString()).toBe('crate-data');
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Failed to index proxied crate serde:1.0.0: Error: index-fail',
      );
      warnSpy.mockRestore();
    });

    it('should handle missing upstream URL', async () => {
      const badProxyRepo = { id: 'p1', type: 'proxy', config: {} };
      const result = await storageMethods.download(
        badProxyRepo as any,
        'serde',
        '1.0.0',
      );
      expect(result.ok).toBe(false);
      expect(result.message).toContain('upstream');
    });

    it('should warn when proxy helper is unavailable', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      proxyHelperModule.default = undefined;
      context.storage.get.mockResolvedValue(null);

      const result = await storageMethods.download(
        proxyRepo as any,
        'serde',
        '1.0.0',
      );

      expect(result.ok).toBe(false);
      expect(result.message).toBe('Proxy helper missing');
      expect(warnSpy).toHaveBeenCalledWith(
        '[Rust] Proxy helper unavailable: Error: proxy helper export is not callable',
      );
      warnSpy.mockRestore();
    });
  });
});
