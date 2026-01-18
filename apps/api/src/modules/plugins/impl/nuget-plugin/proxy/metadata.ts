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

import { PluginContext, Repository } from '../utils/types';

export function initMetadata(context: PluginContext) {
  const getProxyUrl = (repo: Repository) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    return `${proto}://${host}/repository/${repo.name}`;
  };

  const processServiceIndex = (repo: Repository, content: any) => {
    let json;
    try {
      if (Buffer.isBuffer(content)) {
        json = JSON.parse(content.toString());
      } else if (typeof content === 'string') {
        json = JSON.parse(content);
      } else {
        json = content;
      }
    } catch (e) {
      console.error('[NUGET_METADATA] Error parsing service index JSON:', e);
      return content;
    }
    const proxyUrl = getProxyUrl(repo);

    // NuGet V3 Service Index has a list of resources
    if (json.resources && Array.isArray(json.resources)) {
      json.resources.forEach((resource: any) => {
        if (resource['@id']) {
          // Rewrite resource ID to point to our proxy endpoint encoding the original URL
          resource['@id'] =
            `${proxyUrl}/v3-proxy/${encodeURIComponent(resource['@id'])}`;
        }
      });
    }

    return json;
  };

  return { processServiceIndex };
}
