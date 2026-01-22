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

import { buildKey } from '../utils/key-utils';
import { PluginContext, Repository } from '../utils/types';
import { runWithLock } from '../../../../../plugins-core/lock-helper';

async function streamToBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    req.on('data', (c: Buffer) => {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err: any) => {
      reject(err);
    });
  });
}

export function initStorage(context: PluginContext, proxyFetch?: any) {
  const { storage } = context;
  const packageBaseCache: Record<string, string> = {};

  const getPackageBase = async (repo: Repository) => {
    if (packageBaseCache[repo.name]) return packageBaseCache[repo.name];
    if (!proxyFetch) return null;

    try {
      const res = await proxyFetch(repo, 'index.json');
      if (res.status === 200) {
        const json =
          typeof res.body === 'string' || Buffer.isBuffer(res.body)
            ? JSON.parse(res.body.toString())
            : res.body;

        const resource = json.resources?.find(
          (r: any) => r['@type'] === 'PackageBaseAddress/3.0.0',
        );
        if (resource) {
          packageBaseCache[repo.name] = resource['@id'];
          return resource['@id'];
        }
      }
    } catch (e) { }
    return null;
  };

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    if (repo.type === 'group') {
      const writePolicy = repo.config?.writePolicy || 'none';
      const members = repo.config?.members || [];

      if (writePolicy === 'none') {
        return { ok: false, message: 'Group is read-only' };
      }

      const getHostedMembers = async () => {
        const hosted: Repository[] = [];
        if (!context.getRepo) return hosted;
        for (const id of members) {
          const m = await context.getRepo(id);
          if (m && m.type === 'hosted') hosted.push(m);
        }
        return hosted;
      };

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await upload(member, pkg);
          if (result.ok) return result;
        }
        return { ok: false, message: 'No writable member found' };
      }

      if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
        const preferredId = repo.config?.preferredWriter;
        if (!preferredId)
          return { ok: false, message: 'Preferred writer not configured' };
        const member = await context.getRepo?.(preferredId);
        if (!member || member.type !== 'hosted')
          return { ok: false, message: 'Preferred writer unavailable' };
        return await upload(member, pkg);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(hosted.map((m) => upload(m, pkg)));
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    const name = pkg?.name || 'package';
    const version = pkg?.version || '1.0.0';

    const fileName = `${name}.${version}.nupkg`;
    const keyId = buildKey('nuget', repo.id, name, version, fileName);
    const keyName = buildKey('nuget', repo.name, name, version, fileName);

    let buf: Buffer;
    if (pkg?.content) {
      buf = Buffer.isBuffer(pkg.content)
        ? pkg.content
        : Buffer.from(String(pkg.content));
    } else if (pkg?.buffer) {
      buf = Buffer.isBuffer(pkg.buffer) ? pkg.buffer : Buffer.from(pkg.buffer);
    } else {
      buf = Buffer.isBuffer(pkg) ? pkg : Buffer.from(JSON.stringify(pkg));
    }

    const allowRedeploy = (repo.config as any)?.nuget?.allowRedeploy !== false && repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const existingId = await storage.get(keyId).catch(() => null);
      const existingName = await storage.get(keyName).catch(() => null);
      if (existingId || existingName) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    try {
      await storage.save(keyId, buf);
      console.log(`[NuGetPlugin] Successfully uploaded package: ${name}:${version} to key: ${keyId}`);

      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, {
            ok: true,
            id: `${name}:${version}`,
            metadata: { name, version, storageKey: keyId, size: buf.length },
          });
        } catch (ie) { }
      }

      return {
        ok: true,
        id: `${name}:${version}`,
        metadata: { name, version, storageKey: keyId, size: buf.length },
      };
    } catch (err: any) {
      console.error(`[NuGetPlugin] Failed to upload package: ${name}:${version} to repo: ${repo.id}. Error: ${String(err)}`);
      return { ok: false, message: String(err) };
    }
  };

  const download = async (repo: Repository, name: string, version?: string) => {
    let pkgName = name;
    let pkgVersion = version;

    console.log(`[NuGetPlugin] Attempting to download package: ${pkgName}:${pkgVersion || 'latest'} from repo: ${repo.id}`);

    if (repo.type === 'hosted' || repo.type === 'group') {
      const host = process.env.API_HOST || 'localhost:3000';
      const proto = process.env.API_PROTOCOL || 'http';
      const baseUrl = `${proto}://${host}/repository/${repo.name}`;
      const isV3 = (repo.config?.nuget?.version || 'v3') === 'v3';

      if (pkgName === 'index.json' && isV3) {
        return {
          ok: true,
          contentType: 'application/json',
          data: Buffer.from(
            JSON.stringify(
              {
                version: '3.0.0',
                resources: [
                  {
                    '@id': `${baseUrl}/v3/query`,
                    '@type': 'SearchQueryService',
                    comment: 'Query endpoint of NuGet Client',
                  },
                  {
                    '@id': `${baseUrl}/v3/query`,
                    '@type': 'SearchQueryService/3.0.0-beta',
                    comment: 'Query endpoint of NuGet Client',
                  },
                  {
                    '@id': `${baseUrl}/v3/query`,
                    '@type': 'SearchQueryService/3.0.0-rc',
                    comment: 'Query endpoint of NuGet Client',
                  },
                  {
                    '@id': `${baseUrl}/v3/registrations/`,
                    '@type': 'RegistrationsBaseUrl',
                    comment:
                      'Base URL of Azure storage where NuGet package registration is stored',
                  },
                  {
                    '@id': `${baseUrl}/v3/registrations/`,
                    '@type': 'RegistrationsBaseUrl/3.6.0',
                    comment:
                      'Base URL of Azure storage where NuGet package registration is stored',
                  },
                  {
                    '@id': `${baseUrl}/v3/flatcontainer/`,
                    '@type': 'PackageBaseAddress/3.0.0',
                    comment:
                      'Base URL of Azure storage where NuGet package .nupkg is stored',
                  },
                  {
                    '@id': `${baseUrl}/v2/package`,
                    '@type': 'PackagePublish/2.0.0',
                    comment: 'Legacy push endpoint',
                  },
                ],
              },
              null,
              2,
            ),
          ),
        };
      }

      // Handle V3 FlatContainer paths: v3/flatcontainer/{id}/{version}/{id}.{version}.nupkg
      if (isV3 && pkgName.startsWith('v3/flatcontainer/')) {
        const flatParts = pkgName.split('/').filter(Boolean);
        if (flatParts.length >= 4) {
          pkgName = flatParts[2];
          pkgVersion = flatParts[3];
          console.log(`[NuGetPlugin] V3 FlatContainer path parsed. Package: ${pkgName}, Version: ${pkgVersion}`);
        }
      }

      // Handle V2 /package/{id}/{version} paths
      if (pkgName.startsWith('package/')) {
        const pkgParts = pkgName.split('/').filter(Boolean);
        if (pkgParts.length >= 3) {
          pkgName = pkgParts[1];
          pkgVersion = pkgParts[2];
          console.log(`[NuGetPlugin] V2 package path parsed. Package: ${pkgName}, Version: ${pkgVersion}`);
        }
      }

      if (!isV3) {
        if (pkgName === '' || pkgName === '/' || pkgName.toLowerCase() === '$metadata') {
          return {
            ok: true,
            contentType: 'application/xml',
            data: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<service xml:base="${baseUrl}" xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <workspace>
    <atom:title>Default</atom:title>
    <collection href="Packages">
      <atom:title>Packages</atom:title>
    </collection>
  </workspace>
</service>`),
          };
        }

        if (
          pkgName.startsWith('FindPackagesById') ||
          pkgName.startsWith('Packages')
        ) {
          let pkgId = '';
          const idMatch = pkgName.match(/id='([^']+)'/i);
          if (idMatch) pkgId = idMatch[1];
          console.log(`[NuGetPlugin] V2 feed query for package ID: ${pkgId}`);
          const uniqueVersions = new Set<string>();
          if (pkgId) {
            try {
              const reposToScan: { r: Repository; isProxy: boolean }[] = [];

              if (repo.type === 'group') {
                const members = repo.config?.members || [];
                if (context.getRepo) {
                  for (const mId of members) {
                    const m = await context.getRepo(mId);
                    if (m)
                      reposToScan.push({ r: m, isProxy: m.type === 'proxy' });
                  }
                }
              } else {
                reposToScan.push({ r: repo, isProxy: false });
              }

              for (const { r, isProxy } of reposToScan) {
                const prefixes: string[] = [];
                if (isProxy) {
                  prefixes.push(buildKey('nuget', r.id, 'proxy', pkgId));
                } else {
                  prefixes.push(buildKey('nuget', r.id, pkgId));
                  prefixes.push(buildKey('nuget', r.name, pkgId));
                }

                for (const prefix of prefixes) {
                  try {
                    const files = await storage.list(prefix);
                    for (const f of files) {
                      const parts = f.split('/');
                      const pIndex = parts.indexOf(pkgId);
                      if (pIndex !== -1 && parts.length > pIndex + 1) {
                        const v = parts[pIndex + 1];
                        if (v) uniqueVersions.add(v);
                      }
                    }
                  } catch { }
                }
              }
            } catch (e) {
              console.error(`[NuGetPlugin] Error listing versions for ${pkgId}: ${String(e)}`);
            }
          }

          const versions = Array.from(uniqueVersions);
          console.log(`[NuGetPlugin] Found versions for ${pkgId}: ${versions.join(', ')}`);

          const entries = versions
            .map((v) => {
              const downloadUrl = `${baseUrl}/package/${pkgId}/${v}`;
              return `<entry>
    <id>${baseUrl}/Packages(Id='${pkgId}',Version='${v}')</id>
    <category term="NuGetGallery.OData.V2FeedPackage" scheme="http://schemas.microsoft.com/ado/2007/08/dataservices/scheme" />
    <link rel="edit" title="V2FeedPackage" href="Packages(Id='${pkgId}',Version='${v}')" />
    <link rel="self" title="V2FeedPackage" href="Packages(Id='${pkgId}',Version='${v}')" />
    <title type="text">${pkgId}</title>
    <content type="application/zip" src="${downloadUrl}" />
    <m:properties xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
        <d:Id>${pkgId}</d:Id>
        <d:Version>${v}</d:Version>
        <d:NormalizedVersion>${v}</d:NormalizedVersion>
    </m:properties>
</entry>`;
            })
            .join('\n');

          const feed = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xml:base="${baseUrl}">
    <title type="text">Packages</title>
    <id>${baseUrl}/Packages</id>
    <updated>${new Date().toISOString()}</updated>
    ${entries}
</feed>`;

          return {
            ok: true,
            contentType: 'application/xml',
            data: Buffer.from(feed),
          };
        }
      }
    }

    if (repo.type === 'proxy') {
      if (!proxyFetch) return { ok: false, message: 'Proxy not available' };

      const isV3 = (repo.config?.nuget?.version || 'v3') === 'v3';
      if (!isV3) {
        const host = process.env.API_HOST || 'localhost:3000';
        const proto = process.env.API_PROTOCOL || 'http';
        const baseUrl = `${proto}://${host}/repository/${repo.name}`;

        if (pkgName === '' || pkgName === '/' || pkgName.toLowerCase() === '$metadata') {
          return {
            ok: true,
            contentType: 'application/xml',
            data: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<service xml:base="${baseUrl}" xmlns="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <workspace>
    <atom:title>Default</atom:title>
    <collection href="Packages">
      <atom:title>Packages</atom:title>
    </collection>
  </workspace>
</service>`),
          };
        }

        if (
          pkgName.startsWith('FindPackagesById') ||
          pkgName.startsWith('Packages')
        ) {
          console.log(`[NuGetPlugin] Proxying V2 feed query for path: ${pkgName}`);
          const res = await proxyFetch(repo, pkgName);
          if (res.status === 200 && res.body) {
            let xml = res.body.toString();

            const upstreamUrl = (repo.config?.proxyUrl || '').replace(
              /\/$/,
              '',
            );
            if (upstreamUrl) {
              const esc = upstreamUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              const re = new RegExp(esc, 'g');
              xml = xml.replace(re, baseUrl);
            }

            return {
              ok: true,
              contentType: 'application/xml',
              data: Buffer.from(xml),
            };
          }
        }
      }
    }

    // Try to guess from path if version still missing
    if (!pkgVersion && pkgName.includes('/')) {
      const parts = pkgName.split('/').filter(Boolean);
      if (parts.length >= 2) {
        if (parts[parts.length - 1].toLowerCase().endsWith('.nupkg')) {
          if (parts.length >= 3) {
            pkgVersion = parts[parts.length - 2];
            pkgName = parts[parts.length - 3];
          }
        } else {
          pkgVersion = parts[parts.length - 1];
          pkgName = parts[parts.length - 2];
        }
        console.log(`[NuGetPlugin] Guessed package from path: ${pkgName}:${pkgVersion}`);
      }
    }

    if (!pkgVersion) {
      console.warn(`[NuGetPlugin] Download failed for ${pkgName}: Version required but not found.`);
      return { ok: false, message: 'Version required for download' };
    }

    const idLower = pkgName.toLowerCase();
    const versionLower = pkgVersion.toLowerCase();

    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      if (!context.getRepo) return { ok: false, message: 'Context not ready' };

      for (const id of members) {
        try {
          const m = await context.getRepo(id);
          if (!m) continue;

          // Delegate entirely to download logic of the member (hosted or proxy)
          const res = await download(m, idLower, versionLower);
          if (res.ok) return res;
        } catch (e) {
          // ignore
        }
      }
      return { ok: false, message: 'Not found in group' };
    }

    if (repo.type === 'proxy') {
      const fileName = `${idLower}.${versionLower}.nupkg`;
      const proxyKey = buildKey(
        'nuget',
        repo.id,
        'proxy',
        idLower,
        versionLower,
        fileName,
      );
      const legacyProxyKey = buildKey('nuget', repo.id, 'proxy', idLower, versionLower);

      try {
        let cached = await storage.get(proxyKey).catch(() => null);
        if (!cached) cached = await storage.get(legacyProxyKey).catch(() => null);

        if (cached) {
          return {
            ok: true,
            data: cached,
            contentType: 'application/octet-stream',
          };
        }
      } catch { }

      if (!proxyFetch) return { ok: false, message: 'Proxy not available' };

      // Locking & Coalescing
      const lockKey = `nuget:${repo.id}:${idLower}:${versionLower}`;
      return await runWithLock(context, lockKey, async () => {
        let cached = await storage.get(proxyKey).catch(() => null);
        if (!cached)
          cached = await storage.get(legacyProxyKey).catch(() => null);

        if (cached) {
          return {
            ok: true,
            data: cached,
            contentType: 'application/octet-stream',
          };
        }

        const base = await getPackageBase(repo);
        let url: string;
        if (base) {
          url = `${base}${idLower}/${versionLower}/${idLower}.${versionLower}.nupkg`;
        } else {
          url = `${idLower}/${versionLower}/${idLower}.${versionLower}.nupkg`;
        }

        const res = await proxyFetch(repo, url);
        if (res.status === 200) {
          try {
            await storage.save(proxyKey, res.body);
          } catch { }

          return {
            ok: true,
            data: res.body,
            contentType: 'application/octet-stream',
          };
        }
        return { ok: false, message: 'Not found in upstream' };
      });
    }

    const fileName = `${idLower}.${versionLower}.nupkg`;
    const storageKeyId = buildKey('nuget', repo.id, idLower, versionLower, fileName);
    const storageKeyName = buildKey(
      'nuget',
      repo.name,
      idLower,
      versionLower,
      fileName,
    );

    const legacyKeyId = buildKey('nuget', repo.id, idLower, versionLower);
    const legacyKeyName = buildKey('nuget', repo.name, idLower, versionLower);

    try {
      let data = await storage.get(storageKeyId).catch(() => null);
      if (!data) data = await storage.get(storageKeyName).catch(() => null);
      if (!data) data = await storage.get(legacyKeyId).catch(() => null);
      if (!data) data = await storage.get(legacyKeyName).catch(() => null);

      if (!data) return { ok: false, message: 'Not found' };
      return {
        ok: true,
        data,
        contentType: 'application/octet-stream',
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    if (repo.type === 'group') {
      const writePolicy = repo.config?.writePolicy || 'none';
      const members = repo.config?.members || [];

      if (writePolicy === 'none') {
        return { ok: false, message: 'Group is read-only' };
      }

      const getHostedMembers = async () => {
        const hosted: Repository[] = [];
        if (!context.getRepo) return hosted;
        for (const id of members) {
          const m = await context.getRepo(id);
          if (m && m.type === 'hosted') hosted.push(m);
        }
        return hosted;
      };

      if (writePolicy === 'first') {
        const hosted = await getHostedMembers();
        for (const member of hosted) {
          const result = await handlePut(member, path, req);
          if (result.ok) {
            return result;
          }
        }
        return { ok: false, message: 'No writable member found' };
      }

      if (writePolicy === 'preferred' || writePolicy === 'broadcast') {
        const preferredId = repo.config?.preferredWriter;
        if (!preferredId)
          return { ok: false, message: 'Preferred writer not configured' };
        const member = await context.getRepo?.(preferredId);
        if (!member || member.type !== 'hosted')
          return { ok: false, message: 'Preferred writer unavailable' };
        return await handlePut(member, path, req);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };

        let buf: Buffer;
        if (req.body && Buffer.isBuffer(req.body)) {
          buf = req.body;
        } else {
          buf = await streamToBuffer(req);
        }

        const newReq = { ...req, body: buf, buffer: buf };

        const results = await Promise.all(
          hosted.map((m) => handlePut(m, path, newReq)),
        );
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    const parts = path.split('/').filter((p) => p);
    let pkgName = 'unknown';
    let pkgVersion = '0.0.0';

    if (parts.length >= 2) {
      if (parts[parts.length - 1].toLowerCase().endsWith('.nupkg')) {
        if (parts.length >= 3) {
          pkgName = parts[parts.length - 3];
          pkgVersion = parts[parts.length - 2];
        } else {
          pkgName = parts[0];
          pkgVersion = parts[1];
        }
      } else {
        pkgName = parts[0];
        pkgVersion = parts[1];
      }
    }

    // Standardize casing for storage
    pkgName = pkgName.toLowerCase();
    pkgVersion = pkgVersion.toLowerCase();

    console.log(`[NuGetPlugin] handlePut: Attempting to put package ${pkgName}:${pkgVersion} to repo: ${repo.id} via path: ${path}`);

    const fileName = `${pkgName}.${pkgVersion}.nupkg`;
    const keyId = buildKey(
      'nuget',
      repo.id,
      pkgName,
      pkgVersion,
      fileName,
    );

    const allowRedeploy = (repo.config as any)?.nuget?.allowRedeploy !== false && repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const exists = await storage.exists(keyId).catch(() => false);
      if (exists) {
        return {
          ok: false,
          message: `Redeployment of ${pkgName}:${pkgVersion} is not allowed`,
        };
      }
    }

    try {
      let result: any;
      if (
        typeof storage.saveStream === 'function' &&
        !req.body &&
        !req.buffer
      ) {
        result = await storage.saveStream(keyId, req);
      } else {
        let buf: Buffer;
        if (
          req.body &&
          (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))
        ) {
          if (Buffer.isBuffer(req.body)) {
            buf = req.body;
          } else if (typeof req.body === 'object') {
            buf = Buffer.from(JSON.stringify(req.body));
          } else {
            buf = Buffer.from(String(req.body));
          }
        } else {
          buf = await streamToBuffer(req);
        }
        await storage.save(keyId, buf);
        result = { ok: true, size: buf.length };
      }

      const artifactResult = {
        ok: true,
        id: `${pkgName}:${pkgVersion}`,
        metadata: {
          name: pkgName,
          version: pkgVersion,
          storageKey: keyId,
          size: result.size,
          contentHash: result.contentHash,
        },
      };

      if (context.indexArtifact) {
        try {
          await context.indexArtifact(repo, artifactResult);
        } catch (je) {
          console.error('[NuGetPlugin] Failed to index artifact:', je);
        }
      }

      return artifactResult;
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }

  };

  return { upload, download, handlePut };
}
