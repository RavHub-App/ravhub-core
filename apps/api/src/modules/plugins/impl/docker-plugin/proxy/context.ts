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

import type { PluginContext, Repository } from '../utils/types';

export type DockerProxyFetchResponse = {
  ok?: boolean;
  status?: number;
  body?: unknown;
  stream?: unknown;
  headers?: Record<string, string>;
  url?: string;
  storageKey?: string | null;
  message?: string;
};

export type DockerProxyFetchWithAuth = (
  repo: Repository,
  url: string,
  opts?: Record<string, unknown>,
) => Promise<DockerProxyFetchResponse>;

type StorageLike = {
  get: (key: string) => Promise<Buffer | null>;
  save: (key: string, data: Buffer | string) => Promise<unknown>;
  getUrl?: (key: string) => Promise<string>;
};

type ProxyModuleState = {
  storage: StorageLike;
  indexArtifact?: (repo: Repository, result: unknown) => Promise<void>;
  context: PluginContext;
};

let proxyModuleState: ProxyModuleState | null = null;

export function initProxyModuleContext(ctx: PluginContext) {
  proxyModuleState = {
    storage: ctx.storage as StorageLike,
    indexArtifact: (
      ctx as PluginContext & {
        indexArtifact?: (repo: Repository, result: unknown) => Promise<void>;
      }
    ).indexArtifact,
    context: ctx,
  };
}

export function getProxyModuleContext(): ProxyModuleState {
  if (!proxyModuleState) {
    throw new Error('docker proxy context not initialized');
  }

  return proxyModuleState;
}

export function loadProxyFetchWithAuth(): DockerProxyFetchWithAuth | null {
  try {
    return require('../../../../../plugins-core/proxy-helper')
      .default as DockerProxyFetchWithAuth;
  } catch {
    return null;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
