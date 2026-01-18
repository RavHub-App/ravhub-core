/**
 * Raw Plugin - Modular Entry Point
 */

import { configSchema } from './config/schema';
import { authenticate } from './auth/auth';
import { initStorage } from './storage/storage';
import { initPackages } from './packages/list';
import { PluginContext } from './utils/types';

export function createRawPlugin(context: PluginContext) {
  const { upload, download, handlePut } = initStorage(context);
  const { listVersions, getInstallCommand } = initPackages(context);

  return {
    metadata: {
      key: 'raw',
      name: 'Raw',
      description: 'Raw File Repository Plugin',
      configSchema,
      requiresLicense: false,
      licenseType: 'free',
    },
    // Core operations
    upload,
    handlePut,
    download,
    listVersions,
    getInstallCommand,
    authenticate,

    // Lifecycle
    ping: async () => ({ ok: true }),
  };
}

const defaultExport = {
  metadata: {
    key: 'raw',
    name: 'Raw',
    description: 'Raw File Repository Plugin',
    configSchema,
    requiresLicense: false,
    licenseType: 'free',
  },
  authenticate: () => ({ ok: false, message: 'Plugin not initialized' }),
  init: async (context: any) => {
    const plugin = createRawPlugin(context);
    Object.assign(defaultExport, plugin);
    return defaultExport;
  },
};

export default defaultExport;
