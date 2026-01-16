import { buildKey } from '../utils/key-utils';
import { PluginContext, Repository } from '../utils/types';
import { proxyFetchWithAuth } from '../../../../../plugins-core/proxy-helper';

export function initStorage(context: PluginContext) {
  const { storage } = context;

  const upload = async (repo: Repository, pkg: any): Promise<any> => {
    // Group Write Policy Logic
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

    const name = pkg?.name || 'pkg';
    const version = pkg?.version || '0.0.1';
    // Use provided filename or default to tar.gz for hosted packages
    const filename = pkg?.filename || `${name}-${version}.tar.gz`;

    // Store under .../version/filename to mimic standard repo structure
    const keyId = buildKey('pypi', repo.id, name, version, filename);
    const keyName = buildKey('pypi', repo.name, name, version, filename);

    const data = pkg?.content ?? JSON.stringify(pkg ?? {});
    let buf: Buffer;
    if (pkg?.encoding === 'base64' && typeof data === 'string') {
      buf = Buffer.from(data, 'base64');
    } else {
      buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    }

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const existingId = await storage.get(keyId);
      const existingName = await storage.get(keyName);
      if (existingId || existingName) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    try {
      const result = await storage.save(keyId, buf);
      return {
        ok: true,
        id: `${name}:${version}`,
        metadata: {
          name,
          version,
          storageKey: keyId,
          size: result.size ?? buf.length,
          contentHash: result.contentHash,
        },
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const handlePut = async (repo: Repository, path: string, req: any) => {
    // PyPI path structure often: /package/version/filename
    const parts = path.split('/').filter((p) => p);
    let name = 'pkg';
    let version = '0.0.1';
    let filename = 'package.tar.gz';

    if (parts.length >= 3) {
      name = parts[0];
      version = parts[1];
      filename = parts[2];
    } else if (parts.length === 2) {
      name = parts[0];
      version = parts[1];
    } else if (parts.length === 1) {
      name = parts[0];
    }

    const keyId = buildKey('pypi', repo.id, name, version, filename);

    // Check for redeployment policy
    const allowRedeploy = repo.config?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const exists = await storage.exists(keyId);
      if (exists) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${version} is not allowed`,
        };
      }
    }

    try {
      let result: any;
      if (typeof storage.saveStream === 'function' && !req.body && !req.buffer) {
        result = await storage.saveStream(keyId, req);
      } else {
        let buf: Buffer;
        if (req.body && (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))) {
          if (Buffer.isBuffer(req.body)) {
            buf = req.body;
          } else if (typeof req.body === 'object') {
            buf = Buffer.from(JSON.stringify(req.body));
          } else {
            buf = Buffer.from(String(req.body));
          }
        } else {
          const chunks: any[] = [];
          for await (const chunk of req) {
            chunks.push(chunk);
          }
          buf = Buffer.concat(chunks);
        }
        await storage.save(keyId, buf);
        result = { ok: true, size: buf.length };
      }

      return {
        ok: true,
        id: `${name}:${version}`,
        metadata: {
          name,
          version,
          storageKey: keyId,
          size: result.size,
          contentHash: result.contentHash,
        },
      };
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  const download = async (repo: Repository, name: string, version?: string) => {
    console.log(`[PyPI] Download request: repo=${repo.name}, name=${name}, version=${version}`);

    if (!version) {
      // Try to parse from name (path)
      const parts = name.split('/');
      if (parts.length >= 2) {
        version = parts.pop();
        name = parts.join('/');
        console.log(`[PyPI] Parsed from path: name=${name}, version=${version}`);
      } else {
        return { ok: false, message: 'Version required for download' };
      }
    }

    // Group Read Logic
    if (repo.type === 'group') {
      const members = repo.config?.members || [];
      for (const id of members) {
        const member = await context.getRepo?.(id);
        if (member) {
          const result = await download(member, name, version);
          if (result.ok) return result;
        }
      }
      return { ok: false, message: 'Not found in group' };
    }

    const storageKeyId = buildKey('pypi', repo.id, name, version);
    const storageKeyName = buildKey('pypi', repo.name, name, version);
    console.log(`[PyPI] Checking storage key: ${storageKeyId} or ${storageKeyName}`);

    // Check storage
    try {
      // 1. Try exact match (legacy behavior: .../version is the file)
      let data = await storage.get(storageKeyId);
      if (!data) data = await storage.get(storageKeyName);

      // 2. If not found, try listing directory (new behavior: .../version/filename)
      if (!data) {
        const listId = await storage.list(storageKeyId);
        if (listId && listId.length > 0) {
          // Pick the first file found in the version directory
          // TODO: If multiple files exist (whl, tar.gz), we might want to prefer one or allow specifying filename in download args
          console.log(`[PyPI] Found files in version dir: ${listId.join(', ')}`);
          data = await storage.get(listId[0]);
        }
      }

      if (!data) {
        const listName = await storage.list(storageKeyName);
        if (listName && listName.length > 0) {
          console.log(`[PyPI] Found files in version dir (by name): ${listName.join(', ')}`);
          data = await storage.get(listName[0]);
        }
      }

      if (data) {
        console.log(`[PyPI] Found in storage`);
        return {
          ok: true,
          data,
          contentType: 'application/octet-stream',
        };
      } else {
        console.log(`[PyPI] Not found in storage`);
      }
    } catch (err) {
      console.log(`[PyPI] Storage error: ${err}`);
      // ignore
    }    // Proxy Logic
    if (repo.type === 'proxy') {
      const upstreamUrl = repo.config?.proxyUrl || repo.config?.url;
      if (upstreamUrl) {
        try {
          // Simple convention for E2E test: upstream/name/version
          const targetUrl = `${upstreamUrl}/${name}/${version}`;
          const proxyKey = buildKey('pypi', repo.id, 'proxy', name, version);

          const cached = await storage.get(proxyKey);
          if (cached) {
            return {
              ok: true,
              data: cached,
              contentType: 'application/octet-stream',
            };
          }

          const res = await proxyFetchWithAuth(repo, targetUrl);
          if (res.ok && 'body' in res && res.body) {
            await storage.save(proxyKey, res.body as Buffer);

            // Index artifact
            if (context.indexArtifact) {
              try {
                await context.indexArtifact(repo, {
                  ok: true,
                  id: `${name}:${version}`,
                  metadata: {
                    name,
                    version,
                    storageKey: proxyKey,
                    size: (res.body as Buffer).length
                  }
                });
              } catch (e) {
                // ignore
              }
            }

            return { ...res, data: res.body, skipCache: true };
          }
        } catch (e) {
          // ignore
        }
      }
    }

    return { ok: false, message: 'Not found' };
  };

  return { upload, download, handlePut };
}
