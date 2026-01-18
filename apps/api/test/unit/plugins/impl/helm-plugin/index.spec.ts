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

import { createPlugin } from 'src/modules/plugins/impl/helm-plugin/index';

describe('Helm Plugin - Entry Point (Unit)', () => {
  let context: any;

  beforeEach(() => {
    context = {
      storage: { get: jest.fn(), save: jest.fn(), list: jest.fn() },
    };
  });

  it('should initialize and return the plugin object', () => {
    const plugin = createPlugin(context);
    expect(plugin.metadata.key).toBe('helm');
    expect(plugin.metadata.name).toBe('Helm Charts');
  });

  it('should have a working ping', async () => {
    const plugin = createPlugin(context);
    const res = await plugin.ping!();
    expect(res.ok).toBeTruthy();
  });
});
