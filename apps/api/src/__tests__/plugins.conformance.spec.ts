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
