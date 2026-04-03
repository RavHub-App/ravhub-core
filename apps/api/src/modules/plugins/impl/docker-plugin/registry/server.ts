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

import { selectPort } from './port-manager';
import { createRegistryRequestHandler } from './request-handler';
import type { Repository } from '../utils/types';

// Storage for active registry servers
const registryServers = new Map<string, any>();

function hasExplicitPort(host: string) {
  if (!host) {
    return false;
  }

  if (host.startsWith('[') && host.includes(']:')) {
    return true;
  }

  const colonCount = (host.match(/:/g) || []).length;
  if (colonCount === 0) {
    return false;
  }

  if (colonCount > 1) {
    return false;
  }

  return /:\d+$/.test(host);
}

function buildAccessUrl(protocol: string, host: string, port: number) {
  if (hasExplicitPort(host)) {
    return `${protocol}://${host}`;
  }

  return `${protocol}://${host}:${port}`;
}

/**
 * Start a Docker registry server for a repository
 */
export async function startRegistryForRepo(
  repo: Repository,
  opts?: any,
  context?: {
    plugin: any; // Full plugin context with all methods
  },
) {
  try {
    // Check if already running
    const existing = registryServers.get(repo.id || repo.name);
    if (existing) {
      return { ok: true, port: existing.port, accessUrl: existing.accessUrl };
    }

    // Select port
    const { port, needsPersistence } = await selectPort(opts?.port);

    const customHost = repo.config?.docker?.host;
    const host = customHost || 'localhost';
    const proto =
      repo.config?.docker?.protocol || process.env.REGISTRY_PROTOCOL || 'http';
    const accessUrl = buildAccessUrl(proto, host, port);

    // Create a small HTTP server and wire the minimal registry endpoints
    const http = require('http');

    // pick registry version: prefer opts.version -> repo.config.docker.version -> v2
    // Registry V1 is deprecated and removed. We force V2.
    const chosenVersion = 'v2';

    // Get plugin reference from context
    const plugin = context?.plugin;
    if (!plugin) {
      throw new Error('plugin context is required for registry server');
    }

    const server = http.createServer(
      createRegistryRequestHandler(repo, opts, { plugin }),
    );

    // allow binding on all interfaces so other containers (e.g. DIND) can reach the registry
    // previously we bound to 127.0.0.1 which prevented some in-container daemons from reaching the port
    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: any) => reject(e));
      server.listen(port, '0.0.0.0', () => {
        // unref so unit tests // process can exit even if registries remain listening
        if (typeof server.unref === 'function') server.unref();
        resolve();
      });
    });

    registryServers.set(repo.id || repo.name, {
      server,
      port,
      accessUrl,
      version: chosenVersion,
    });

    return {
      ok: true,
      port,
      accessUrl,
      version: chosenVersion,
      needsPersistence, // Indicates if the port was auto-selected and should be saved to DB
    };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Stop a Docker registry server for a repository
 */
export async function stopRegistryForRepo(repo: Repository) {
  try {
    const key = repo.id || repo.name;
    const inst = registryServers.get(key);
    if (!inst) return { ok: false, message: 'not found' };

    try {
      await new Promise<void>((resolve, reject) => {
        inst.server.close((err: Error | undefined) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    } catch (e) {
      console.warn('[DOCKER REGISTRY STOP]', e);
    }

    registryServers.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

/**
 * Get the active registry servers map (for integration with main plugin)
 */
export function getRegistryServers(): Map<string, any> {
  return registryServers;
}
