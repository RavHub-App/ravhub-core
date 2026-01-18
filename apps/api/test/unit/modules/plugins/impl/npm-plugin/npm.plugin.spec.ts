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

import { createNpmPlugin } from 'src/modules/plugins/impl/npm-plugin/index';
import { PluginContext } from 'src/modules/plugins/impl/npm-plugin/utils/types';

jest.mock('src/modules/plugins/impl/npm-plugin/storage/storage', () => ({
  initStorage: jest.fn(() => ({
    download: jest.fn(),
    handlePut: jest.fn(),
  })),
}));

jest.mock('src/modules/plugins/impl/npm-plugin/proxy/fetch', () => ({
  initProxy: jest.fn(() => ({
    proxyFetch: jest.fn(),
  })),
}));

jest.mock('src/modules/plugins/impl/npm-plugin/packages/list', () => ({
  initPackages: jest.fn(() => ({
    listVersions: jest.fn(),
    getInstallCommand: jest.fn(),
  })),
}));

jest.mock('src/modules/plugins/impl/npm-plugin/auth/auth', () => ({
  authenticate: jest.fn(),
}));

describe('NpmPlugin (Index)', () => {
  let mockContext: PluginContext;

  beforeEach(() => {
    mockContext = {
      storage: { get: jest.fn(), save: jest.fn() },
      redis: {},
      getRepo: jest.fn(),
      indexArtifact: jest.fn(),
    } as any;
    jest.clearAllMocks();
  });

  it('should create plugin instance with correct metadata', () => {
    const plugin = createNpmPlugin(mockContext);

    expect(plugin.metadata.key).toBe('npm');
    expect(plugin.metadata.name).toBe('NPM');
    expect(plugin.download).toBeDefined();
    expect(plugin.handlePut).toBeDefined();
    expect(plugin.proxyFetch).toBeDefined();
    expect(plugin.listVersions).toBeDefined();
    expect(plugin.getInstallCommand).toBeDefined();
    expect(plugin.authenticate).toBeDefined();
    expect(plugin.pingUpstream).toBeDefined();
  });

  it('should have ping method', async () => {
    const plugin = createNpmPlugin(mockContext);
    const result = await plugin.ping();
    expect(result.ok).toBe(true);
  });
});
