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

import { createDockerPlugin } from 'src/modules/plugins/impl/docker-plugin/index';
import { PluginContext } from 'src/modules/plugins/impl/docker-plugin/utils/types';

// Mock dependencies
jest.mock('src/modules/plugins/impl/docker-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/config/schema', () => ({
  configSchema: {},
}));
jest.mock('src/modules/plugins/impl/docker-plugin/auth/auth', () => ({
  issueToken: jest.fn(),
  authenticate: jest.fn(),
  generateToken: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/utils/helpers', () => ({
  normalizeImageName: jest.fn(),
  uploads: new Map(),
  uploadTargets: new Map(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/storage/upload', () => ({
  initUpload: jest.fn(),
  initiateUpload: jest.fn(),
  appendUpload: jest.fn(),
  finalizeUpload: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/storage/download', () => ({
  initDownload: jest.fn(),
  download: jest.fn(),
  getBlob: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/storage/manifest', () => ({
  initManifest: jest.fn(),
  putManifest: jest.fn(),
  deleteManifest: jest.fn(),
  deletePackageVersion: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/proxy/fetch', () => ({
  initProxyFetch: jest.fn(),
  proxyFetch: jest.fn(),
  pingUpstream: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/packages/list', () => ({
  initPackages: jest.fn(),
  listPackages: jest.fn(),
  getPackage: jest.fn(),
  listVersions: jest.fn(),
  getInstallCommand: jest.fn(),
}));
jest.mock('src/modules/plugins/impl/docker-plugin/registry/server', () => ({
  startRegistryForRepo: jest.fn(),
  stopRegistryForRepo: jest.fn(),
  getRegistryServers: jest.fn(),
}));

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
}));

describe('DockerPlugin (Index)', () => {
  let mockContext: PluginContext;
  const ORIGINAL_ENV = process.env;

  beforeAll(() => {
    process.env = { ...ORIGINAL_ENV, JWT_SECRET: 'secret' };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  beforeEach(() => {
    mockContext = {
      storage: {
        get: jest.fn(),
        save: jest.fn(),
      },
      redis: {},
      getRepo: jest.fn(),
      indexArtifact: jest.fn(),
    } as any;
    jest.clearAllMocks();
  });

  it('should create plugin instance', () => {
    const plugin = createDockerPlugin(mockContext);

    expect(plugin.id).toBe('docker');
    expect(plugin.initiateUpload).toBeDefined();
    expect(plugin.download).toBeDefined();
    // expect(plugin.handlePut).toBeDefined(); // Docker uses V2 API via request/registry
    expect(plugin.proxyFetch).toBeDefined();
    // and so on
  });

  it('should use context.getRepo if available', async () => {
    const plugin = createDockerPlugin(mockContext);
    const mockRepo = { id: 'r1' };
    (mockContext.getRepo as jest.Mock).mockResolvedValue(mockRepo);

    // getRepo is exposed on plugin (internal usage but exposed for helpers/registry)
    // We need to cast plugin as any or verify type
    const retrieved = await (plugin as any).getRepo('r1');

    expect(mockContext.getRepo).toHaveBeenCalledWith('r1');
    expect(retrieved).toBe(mockRepo);
  });

  it('should fallback to storage for getRepo if context.getRepo missing', async () => {
    // Remove context.getRepo
    mockContext.getRepo = undefined as any;
    const plugin = createDockerPlugin(mockContext);

    const mockRepoData = JSON.stringify({ id: 'r1', name: 'fallback' });
    (mockContext.storage.get as jest.Mock).mockResolvedValue(
      Buffer.from(mockRepoData),
    );

    const retrieved = await (plugin as any).getRepo('r1');

    expect(mockContext.storage.get).toHaveBeenCalled(); // valid call
    expect(retrieved).toEqual({ id: 'r1', name: 'fallback' });
  });

  // Add specific function tests if index.ts exports logic wrappings
  // For example, handlePut delegating to storage logic.
  // Or helpers like fallbackGetRepo.

  // I can test indexArtifact wrapper logic if I can trigger it.
  // index.ts: const indexArtifact = ...
  // And it is passed to services via init*(ctx)?
  // Inspecting index.ts shows it passes context with new helpers to sub-inits.
  // e.g. initUpload({ ...context, indexArtifact });

  it('should index artifact and call context.indexArtifact', async () => {
    const plugin = createDockerPlugin(mockContext);
    const repo = { id: 'r1', name: 'repo1' };
    // indexArtifact(repo, name, tag, metadata, userId)
    await (plugin as any).indexArtifact(
      repo,
      'imageName',
      'latest',
      { size: 100 },
      'u1',
    );

    // Check storage save calls (index file)
    expect(mockContext.storage.save).toHaveBeenCalled();

    // Check context.indexArtifact call
    expect(mockContext.indexArtifact).toHaveBeenCalledWith(
      repo,
      expect.objectContaining({
        id: 'imageName:latest',
        ok: true,
        metadata: expect.objectContaining({ size: 100 }),
      }),
      'u1',
    );
  });

  it('should handle /v2/token request', async () => {
    const plugin = createDockerPlugin(mockContext);
    const req = {
      path: '/v2/token',
      query: {
        service: 'registry',
        scope: 'repository:sammy/ubuntu:pull,push',
      },
    };
    const res = await (plugin as any).request(mockContext, req);

    expect(res.status).toBe(200);
    expect(res.body.token).toBe('mock-jwt-token');

    const jwt = require('jsonwebtoken');
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({
        aud: 'registry',
        access: expect.arrayContaining([
          expect.objectContaining({
            name: 'sammy/ubuntu',
            actions: ['pull', 'push'],
          }),
        ]),
      }),
      'secret',
    );
  });
});
