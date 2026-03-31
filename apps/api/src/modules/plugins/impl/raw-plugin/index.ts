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
