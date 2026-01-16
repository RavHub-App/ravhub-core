import npmPlugin from '../modules/plugins/impl/npm-plugin';
import mavenPlugin from '../modules/plugins/impl/maven-plugin';
import dockerPlugin from '../modules/plugins/impl/docker-plugin';
import composerPlugin from '../modules/plugins/impl/composer-plugin';
import pypiPlugin from '../modules/plugins/impl/pypi-plugin';
import rawPlugin from '../modules/plugins/impl/raw-plugin';
import nugetPlugin from '../modules/plugins/impl/nuget-plugin';
import rustPlugin from '../modules/plugins/impl/rust-plugin';

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
