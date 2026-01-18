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
  const { storage } = context;

  const getProxyUrl = (repo: Repository) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    return `${proto}://${host}/repository/${repo.name}`;
  };

  const rewriteUrl = (url: string, repoUrl: string, upstreamUrl: string) => {
    if (!url) return url;
    if (url.startsWith(upstreamUrl)) {
      return url.replace(upstreamUrl, repoUrl);
    }
    if (url.startsWith('http')) return url; // Already absolute, maybe external?
    // If it starts with /, it's relative to domain root. We want it relative to repoUrl.
    // But we should probably make it absolute to our repo.
    if (url.startsWith('/')) {
      return `${repoUrl}${url}`;
    }
    return `${repoUrl}/${url}`;
  };

  const processMetadata = async (
    repo: Repository,
    url: string,
    content: any,
    upstreamUrl: string,
  ) => {
    const repoUrl = getProxyUrl(repo);
    let json;
    if (Buffer.isBuffer(content)) {
      json = JSON.parse(content.toString('utf8'));
    } else if (typeof content === 'string') {
      json = JSON.parse(content);
    } else {
      json = content;
    }

    if (json['metadata-url']) {
    }

    // Rewrite top-level fields in packages.json
    const fields = [
      'metadata-url',
      'providers-url',
      'list-url',
      'notify-batch',
      'search',
    ];

    for (const field of fields) {
      if (json[field]) {
        const original = json[field];
        json[field] = rewriteUrl(json[field], repoUrl, upstreamUrl);
        if (original !== json[field]) {
        }
      }
    }

    // Rewrite includes
    if (json.includes) {
      const newIncludes: any = {};
      for (const [path, hash] of Object.entries(json.includes)) {
        const newPath = rewriteUrl(path, repoUrl, upstreamUrl);
        newIncludes[newPath] = hash;
      }
      // We can't easily change the keys if they are paths, because Composer uses them to fetch.
      // Wait, if we change the key in 'includes', Composer will fetch the NEW key.
      // So we replace the old includes with new includes
      json.includes = newIncludes;
    }

    // Rewrite provider-includes
    if (json['provider-includes']) {
      const newIncludes: any = {};
      for (const [path, hash] of Object.entries(json['provider-includes'])) {
        const newPath = rewriteUrl(path, repoUrl, upstreamUrl);
        newIncludes[newPath] = hash;
      }
      json['provider-includes'] = newIncludes;
    }

    // Rewrite packages (if present, e.g. in includes or Satis)
    if (json.packages) {
      for (const pkgName of Object.keys(json.packages)) {
        const versions = json.packages[pkgName];
        for (const key of Object.keys(versions)) {
          const pkg = versions[key];
          // Use explicit version from package definition if available (handles array-based versions), otherwise use key
          const version = pkg.version || key;

          if (pkg.dist && pkg.dist.url) {
            // Check cacheMaxAgeDays to determine if we should proxy artifacts
            // 0 = metadata-only (no artifact proxying)
            // > 0 = proxy-dist (cache artifacts)
            const retention = repo.config?.cacheMaxAgeDays ?? 7;
            if (retention > 0) {
              let distUrl = pkg.dist.url;
              try {
                // Resolve relative URLs against the current metadata file URL
                distUrl = new URL(distUrl, url).toString();
              } catch (e) {
                // ignore invalid URLs
              }
              pkg.dist.url = `${repoUrl}/dist/${Buffer.from(distUrl).toString('base64')}/${pkgName}/${version}.zip`;
            }
          }
        }
      }
    }

    return JSON.stringify(json);
  };

  const proxyMetadata = async (repo: Repository, name: string) => {
    const {
      default: proxyFetchWithAuth,
    } = require('../../../../../plugins-core/proxy-helper');

    // Determine upstream URL
    let upstreamUrl = repo.config?.proxyUrl;
    if (!upstreamUrl) {
      return { ok: false, message: 'No proxy URL configured' };
    }

    // Remove trailing slash from upstream
    if (upstreamUrl.endsWith('/')) upstreamUrl = upstreamUrl.slice(0, -1);

    // Construct target URL
    // If name is 'packages.json', it's root.
    // If name is 'p/...', it's a path.
    let targetUrl = upstreamUrl;
    if (name !== 'packages.json') {
      // Ensure name doesn't start with // if we append
      const cleanName = name.startsWith('/') ? name.slice(1) : name;
      targetUrl = `${upstreamUrl}/${cleanName}`;
    } else {
      targetUrl = `${upstreamUrl}/packages.json`;
    }

    try {
      const result = await proxyFetchWithAuth(repo, targetUrl);
      if (!result.ok) return result;

      // If it's a JSON file, we process it
      if (name.endsWith('.json') && result.body) {
        const processed = await processMetadata(
          repo,
          name,
          result.body,
          upstreamUrl,
        );
        return {
          ok: true,
          data: processed,
          contentType: 'application/json',
        };
      }
      return {
        ok: true,
        data: result.body,
        contentType:
          result.headers?.['content-type'] || 'application/octet-stream',
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { proxyMetadata, processMetadata };
}
