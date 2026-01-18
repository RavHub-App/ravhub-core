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

import {
  PluginContext,
  IPlugin,
} from '../../../../plugins-core/plugin.interface';
import { configSchema } from './config/schema';
import { authenticate } from './auth/auth';
import { initStorage } from './storage/storage';
import { initProxy } from './proxy/fetch';
import { initPackages } from './packages/list';

export function createPlugin(context: PluginContext): IPlugin {
  const { upload, download, handlePut } = initStorage(context);
  const { proxyFetch } = initProxy(context);
  const { listVersions, getInstallCommand } = initPackages(context);

  /**
   * Ping the upstream/proxy target for a repository to test reachability.
   */
  const pingUpstream = async (repo: any, context: PluginContext) => {
    const target = repo.config?.proxyUrl;
    if (!target) return { ok: false, message: 'no upstream configured' };

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
      key: 'helm',
      name: 'Helm Charts',
      description: 'Helm Chart Repository Plugin',
      requiresLicense: true,
      licenseType: 'enterprise',
      configSchema,
      icon: '/assets/icons/helm.png',
    },
    // Core operations
    upload,
    handlePut,
    download,
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
    key: 'helm',
    name: 'Helm Charts',
    description: 'Helm Chart Repository Plugin',
    configSchema,
  },
  authenticate: () => ({ ok: false, message: 'Plugin not initialized' }),
  init: async (context: any) => {
    const plugin = createPlugin(context);
    Object.assign(defaultExport, plugin);
    return defaultExport;
  },
};

export default defaultExport;
