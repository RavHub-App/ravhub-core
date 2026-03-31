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

import { PluginContext } from '../../../../../plugins-core/plugin.interface';
import { buildKey } from '../utils/key-utils';
import { handleMagicProxyFetch, handleStandardProxyFetch } from './proxy-cache';
import { HelmRepository } from './proxy-helpers';

export function initProxy(context: PluginContext) {
  return {
    proxyFetch: async (repo: HelmRepository, url: string) => {
      if (url.startsWith('helm-proxy/')) {
        return handleMagicProxyFetch(context, repo, url, buildKey);
      }

      return handleStandardProxyFetch(context, repo, url, buildKey);
    },
  };
}
