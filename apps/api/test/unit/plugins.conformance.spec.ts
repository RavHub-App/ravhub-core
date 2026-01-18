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

import npmPlugin from '../../src/modules/plugins/impl/npm-plugin';
import mavenPlugin from '../../src/modules/plugins/impl/maven-plugin';
import dockerPlugin from '../../src/modules/plugins/impl/docker-plugin';
import composerPlugin from '../../src/modules/plugins/impl/composer-plugin';
import pypiPlugin from '../../src/modules/plugins/impl/pypi-plugin';
import rawPlugin from '../../src/modules/plugins/impl/raw-plugin';
import nugetPlugin from '../../src/modules/plugins/impl/nuget-plugin';
import rustPlugin from '../../src/modules/plugins/impl/rust-plugin';

const PLUGINS: Array<any> = [
  npmPlugin,
  mavenPlugin,
  dockerPlugin,
  composerPlugin,
  pypiPlugin,
  rawPlugin,
  nugetPlugin,
  rustPlugin,
];

describe('Plugin conformance', () => {
  it('each plugin should expose metadata.key and at least one operation method', () => {
    const keys = new Set<string>();
    for (const p of PLUGINS) {
      expect(p).toBeDefined();
      expect(p.metadata).toBeDefined();
      expect(typeof p.metadata.key).toBe('string');
      // unique keys
      expect(keys.has(p.metadata.key)).toBe(false);
      keys.add(p.metadata.key);

      const hasOp = !!(
        typeof p.upload === 'function' ||
        typeof p.download === 'function' ||
        typeof p.listVersions === 'function' ||
        typeof p.proxyFetch === 'function' ||
        typeof p.authenticate === 'function'
      );
      expect(hasOp).toBe(true);
      // init should be a function if present
      if (p.init) expect(typeof p.init).toBe('function');
    }
  });
});
