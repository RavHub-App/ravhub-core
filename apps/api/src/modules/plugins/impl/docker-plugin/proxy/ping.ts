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

import type { Repository } from '../utils/types';
import { loadProxyFetchWithAuth } from './context';

export async function pingDockerUpstream(repo: Repository) {
  try {
    const target =
      repo?.config?.docker?.proxyUrl ||
      repo?.config?.upstream ||
      repo?.config?.docker?.upstream ||
      repo?.config?.target ||
      repo?.config?.registry ||
      null;

    if (!target) {
      return { ok: false, message: 'no upstream configured' };
    }

    const pingUrl = `${String(target).replace(/\/$/, '')}/v2/`;
    const proxyFetchWithAuth = loadProxyFetchWithAuth();
    if (!proxyFetchWithAuth) {
      return {
        ok: false,
        message: 'proxy-helper not found (plugins-core/proxy-helper)',
      };
    }

    let response;
    try {
      response = await proxyFetchWithAuth(repo, pingUrl, {
        stream: false,
        timeoutMs: 5000,
        maxRetries: 1,
      });
    } catch (error) {
      return {
        ok: false,
        message: String(error instanceof Error ? error.message : error),
      };
    }

    if (response && typeof response.status === 'number') {
      const bodyMessage =
        typeof response.body === 'object' &&
        response.body &&
        'message' in response.body
          ? String((response.body as { message?: unknown }).message)
          : undefined;

      return {
        ok: response.ok || response.status < 500,
        status: response.status,
        reachable: response.status < 500,
        url: pingUrl,
        message: response.ok
          ? undefined
          : bodyMessage || 'Upstream returned error status',
      };
    }

    return { ok: false, message: 'no response from upstream' };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
