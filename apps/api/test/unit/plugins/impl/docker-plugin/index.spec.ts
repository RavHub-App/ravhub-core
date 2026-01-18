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

describe('Docker Plugin - Entry Point (Unit)', () => {
  let context: any;
  let mockStorage: any;
  let mockGetRepo: any;
  let mockIndexSvc: any;

  beforeEach(() => {
    mockStorage = {
      save: jest.fn().mockResolvedValue({}),
      get: jest.fn(),
    };
    mockGetRepo = jest.fn();
    mockIndexSvc = jest.fn();

    context = {
      storage: mockStorage,
      getRepo: mockGetRepo,
      indexArtifact: mockIndexSvc,
    };
  });

  it('should initialize and return the plugin object', () => {
    const plugin = createDockerPlugin(context);
    expect(plugin.name).toBe('Docker Registry');
    expect(plugin.supportedTypes).toContain('hosted');
  });

  it('should index an artifact', async () => {
    const plugin = createDockerPlugin(context);
    const repo = { id: 'r1', name: 'repo1' } as any;
    const result = { id: 'img:v1', metadata: { size: 100 } };

    await (plugin as any).indexArtifact(repo, result);

    expect(mockStorage.save).toHaveBeenCalled();
    expect(mockIndexSvc).toHaveBeenCalledWith(
      repo,
      expect.objectContaining({
        id: 'img:v1',
      }),
      undefined,
    );
  });

  it('should track downloads', async () => {
    const plugin = createDockerPlugin(context);
    const repo = { id: 'r1', name: 'repo1' } as any;

    await (plugin as any).trackDownload(repo, 'img', 'v1');
    expect(mockStorage.save).toHaveBeenCalled();
  });
});
