/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

/**
 * PyPI Plugin - Modular Entry Point
 */

import { configSchema } from './config/schema';
import { authenticate } from './auth/auth';
import { initStorage } from './storage/storage';
import { initProxy } from './proxy/fetch';
import { initPackages } from './packages/list';
import { PluginContext, Repository } from './utils/types';

export function createPypiPlugin(context: PluginContext) {
  const { proxyFetch } = initProxy(context);
  const { upload, download, handlePut } = initStorage(context);
  const { listVersions, getInstallCommand } = initPackages(context);

  /**
   * Ping the upstream/proxy target for a repository to test reachability.
   */
  const pingUpstream = async (repo: any, context: PluginContext) => {
    const target = repo.config?.proxyUrl || 'https://pypi.org/simple';
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
      key: 'pypi',
      name: 'PyPI',
      description: 'PyPI Repository Plugin',
      configSchema,
      requiresLicense: true,
      licenseType: 'enterprise',
    },
    // Core operations
    upload,
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
    key: 'pypi',
    name: 'PyPI',
    description: 'PyPI Repository Plugin',
    configSchema,
    requiresLicense: true,
    licenseType: 'enterprise',
  },
  authenticate: () => ({ ok: false, message: 'Plugin not initialized' }),
  init: async (context: any) => {
    const plugin = createPypiPlugin(context);
    Object.assign(defaultExport, plugin);
    return defaultExport;
  },
};

export default defaultExport;
