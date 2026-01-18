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

const UPSTREAM_KEYS = new Set([
  'target',
  'registry',
  'upstream',
  'indexUrl',
  'proxyUrl',
]);

function countUpstreamKeys(schema: any): number {
  if (!schema || typeof schema !== 'object') return 0;
  let count = 0;
  if (schema.properties && typeof schema.properties === 'object') {
    for (const [k, v] of Object.entries<any>(schema.properties)) {
      if (UPSTREAM_KEYS.has(k)) count++;
      // also recurse into nested objects
      count += countUpstreamKeys(v);
    }
  }
  return count;
}

describe('Plugin upstream configuration', () => {
  it('each plugin should declare at most one upstream-like field in configSchema', () => {
    for (const p of PLUGINS) {
      const schema = p?.metadata?.configSchema ?? null;
      const upstreamCount = countUpstreamKeys(schema);
      // allow 0 or 1 upstream-like properties only
      expect(upstreamCount).toBeLessThanOrEqual(1);
      if (upstreamCount === 1) {
        // sanity: plugin should be capable of proxying if it declares an upstream config
        const supportsProxy = !!(p.proxyFetch || p.download || p.listVersions);
        expect(supportsProxy).toBe(true);
      }
    }
  });
});
