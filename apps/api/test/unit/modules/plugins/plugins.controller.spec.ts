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

import { PluginsController } from 'src/modules/plugins/plugins.controller';
import { PluginsService } from 'src/modules/plugins/plugins.service';

describe('PluginsController (Unit)', () => {
  let controller: PluginsController;
  let service: jest.Mocked<PluginsService>;

  beforeEach(() => {
    service = {
      list: jest.fn(),
      getInstance: jest.fn(),
      ping: jest.fn(),
      reloadPlugins: jest.fn(),
    } as any;
    controller = new PluginsController(service);
  });

  it('should list plugins', () => {
    service.list.mockReturnValue([]);
    expect(controller.list()).toEqual([]);
  });

  it('should return schema for a plugin', () => {
    service.getInstance.mockReturnValue({
      metadata: { key: 'npm', name: 'NPM', configSchema: { type: 'object' } },
    } as any);
    const res = controller.getSchema('npm');
    expect(res.found).toBeTruthy();
    if (res.found) {
      expect(res.schema).toEqual({ type: 'object' });
    }
  });

  it('should return found: false if plugin missing for schema', () => {
    service.getInstance.mockReturnValue(undefined);
    const res = controller.getSchema('missing');
    expect(res.found).toBeFalsy();
  });

  it('should reload plugins', async () => {
    service.reloadPlugins.mockResolvedValue({
      ok: true,
      message: 'done',
      newPlugins: [],
    });
    const res = await controller.reloadPlugins();
    expect(res.ok).toBeTruthy();
  });

  it('should return plugin status', async () => {
    service.list.mockReturnValue([{ key: 'npm' }, { key: 'docker' }] as any);
    const res = await controller.getPluginStatus();
    expect(res.plugins.loaded).toContain('npm');
    expect(res.edition).toBe('community');
    expect(res.requiresLicense).toBeFalsy();
  });
});
