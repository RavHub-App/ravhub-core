/**
 * NPM Plugin - Modular Entry Point
 */

import { configSchema } from './config/schema';
import { authenticate } from './auth/auth';
import { initStorage } from './storage/storage';
import { initProxy } from './proxy/fetch';
import { initPackages } from './packages/list';
import { PluginContext, Repository } from './utils/types';

export function createNpmPlugin(context: PluginContext) {
  const { proxyFetch } = initProxy(context);
  const { download, handlePut } = initStorage(context);
  const { listVersions, getInstallCommand } = initPackages(context);

  /**
   * Ping the upstream/proxy target for a repository to test reachability.
   */
  const pingUpstream = async (repo: any, context: PluginContext) => {
    const target = repo.config?.proxyUrl || 'https://registry.npmjs.org';
    const proxyFetchWithAuth =
      require('../../../../plugins-core/proxy-helper').default;

    try {
      const res = await proxyFetchWithAuth(repo, target, {
        method: 'GET',
        timeoutMs: 5000,
        maxRetries: 1,
      });

      return {
        ok: res.ok || (res.status > 0 && res.status < 500),
        status: res.status,
        reachable: res.status > 0 && res.status < 500,
        message: res.ok
          ? undefined
          : res.body?.message || 'Upstream returned error status',
      };
    } catch (err: any) {
      return { ok: false, message: String(err?.message ?? err) };
    }
  };

  return {
    metadata: {
      key: 'npm',
      name: 'NPM',
      description: 'NPM Registry Plugin',
      requiresLicense: false,
      licenseType: 'free',
      configSchema,
    },
    // Core operations
    download,
    handlePut,
    proxyFetch,
    listVersions,
    getInstallCommand,
    authenticate,
    pingUpstream,

    // Lifecycle
    ping: async () => ({ ok: true }),
  };
}

const defaultExport = {
  metadata: {
    key: 'npm',
    name: 'NPM',
    description: 'NPM Registry Plugin',
    configSchema,
  },
  authenticate: () => ({ ok: false, message: 'Plugin not initialized' }),
  init: async (context: any) => {
    const plugin = createNpmPlugin(context);
    Object.assign(defaultExport, plugin);
    return defaultExport;
  },
};

export default defaultExport;
