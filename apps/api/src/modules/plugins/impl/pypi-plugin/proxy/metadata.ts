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

import { PluginContext, Repository } from '../utils/types';
import * as cheerio from 'cheerio';

export function initMetadata(context: PluginContext) {
  const getProxyUrl = (repo: Repository) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    return `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
  };

  const getUpstreamPageUrl = (repo: Repository, currentPath?: string) => {
    const upstreamBase = String(repo.config?.proxyUrl || '').replace(/\/$/, '');
    if (!currentPath) {
      return upstreamBase ? `${upstreamBase}/` : undefined;
    }

    let normalizedPath = currentPath.replace(/^\//, '');
    if (
      upstreamBase.endsWith('/simple') &&
      normalizedPath.startsWith('simple/')
    ) {
      normalizedPath = normalizedPath.slice('simple/'.length);
    }

    return upstreamBase ? `${upstreamBase}/${normalizedPath}` : undefined;
  };

  const processSimpleIndex = (
    repo: Repository,
    html: string,
    currentPath?: string,
  ) => {
    const $ = cheerio.load(html);
    const proxyUrl = getProxyUrl(repo);
    const upstreamPageUrl = getUpstreamPageUrl(repo, currentPath);

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        let fullUrl: string | undefined;
        if (href.startsWith('http')) {
          fullUrl = href;
        } else if (href.startsWith('//')) {
          fullUrl = `https:${href}`;
        } else if (upstreamPageUrl) {
          fullUrl = new URL(href, upstreamPageUrl).toString();
        }

        if (fullUrl) {
          const encoded = encodeURIComponent(fullUrl);
          $(el).attr('href', `${proxyUrl}/pypi-proxy/${encoded}`);
        }
      }
    });

    return $.html();
  };

  return { processSimpleIndex };
}
