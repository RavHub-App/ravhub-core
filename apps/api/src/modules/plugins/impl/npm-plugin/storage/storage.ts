import { buildKey } from '../utils/key-utils';
import { PluginContext, Repository } from '../utils/types';
import { mergeMetadata, createInitialMetadata, NpmMetadata } from '../utils/metadata';

async function streamToBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export function initStorage(context: PluginContext, proxyFetch?: any) {
  const { storage } = context;

  const saveFile = async (repo: Repository, path: string, data: Buffer) => {
    const key = buildKey('npm', repo.id, path);
    return await storage.save(key, data);
  };

  const saveFileStream = async (repo: Repository, path: string, stream: any) => {
    const key = buildKey('npm', repo.id, path);
    if (typeof storage.saveStream === 'function') {
      return await storage.saveStream(key, stream);
    }
    const buf = await streamToBuffer(stream);
    return await storage.save(key, buf);
  };

  const getFile = async (repo: Repository, path: string) => {
    const keyId = buildKey('npm', repo.id, path);
    const res = await storage.get(keyId);
    if (res) return res;

    const keyName = buildKey('npm', repo.name, path);
    return await storage.get(keyName);
  };

  const handlePut = async (repo: Repository, path: string, req: any): Promise<any> => {
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
        return await handlePut(member, path, req);
      }

      if (writePolicy === 'mirror') {
        const hosted = await getHostedMembers();
        if (hosted.length === 0)
          return { ok: false, message: 'No hosted members' };
        const results = await Promise.all(hosted.map((m) => handlePut(m, path, req)));
        const success = results.find((r) => r.ok);
        if (success) return success;
        return { ok: false, message: 'Mirror write failed on all members' };
      }

      return { ok: false, message: 'Unknown write policy' };
    }

    // Optimization: Stream .tgz files directly to storage (bypass memory buffer)
    if (path.includes('/-/') && !req.body && (!req.buffer || req.buffer.length === 0)) {
      const res = await saveFileStream(repo, path, req);
      return { ok: res.ok, message: 'File uploaded (stream)', metadata: { ...res, storageKey: res.path } };
    }

    let buffer: Buffer;
    // If body is already parsed by NestJS/Express (e.g. application/json)
    if (req.body && (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))) {
      if (Buffer.isBuffer(req.body)) {
        buffer = req.body;
      } else if (typeof req.body === 'object') {
        buffer = Buffer.from(JSON.stringify(req.body));
      } else {
        buffer = Buffer.from(String(req.body));
      }
    } else {
      buffer = await streamToBuffer(req);
    }

    // Simple heuristic: if path contains "/-/", it is likely a tarball or attachment
    if (path.includes('/-/')) {
      await saveFile(repo, path, buffer);
      return { ok: true, message: 'File uploaded' };
    }

    let incoming: NpmMetadata;
    try {
      incoming = JSON.parse(buffer.toString());
    } catch (e) {
      console.error('[NPM] Invalid JSON metadata', e);
      return { ok: false, message: 'Invalid JSON' };
    }

    // If path is a package name, store as package.json inside the directory
    // This avoids conflict with the directory created for attachments (pkg/-/)
    const metaPath = (!path.includes('/-/') && !path.endsWith('.tgz'))
      ? `${path}/package.json`
      : path;

    const metadata = await getFile(repo, metaPath);
    let current: NpmMetadata | undefined;
    if (metadata) {
      try {
        current = JSON.parse(metadata.toString());
      } catch (e) {
        // ignore
      }
    }

    const merged = mergeMetadata(current || createInitialMetadata(incoming.name), incoming);

    // Handle attachments from metadata (if any)
    let lastAttachmentResult: any;
    if (incoming._attachments) {
      for (const [filename, attachment] of Object.entries(incoming._attachments)) {
        const attachmentData = Buffer.from(attachment.data, 'base64');
        const attachmentPath = `${merged.name}/-/${filename}`;
        lastAttachmentResult = await saveFile(repo, attachmentPath, attachmentData);
      }
    }

    const metaResult = await saveFile(repo, metaPath, Buffer.from(JSON.stringify(merged, null, 2)));

    return {
      ok: true,
      message: 'Package published',
      metadata: {
        name: merged.name,
        version: merged['dist-tags']?.latest || Object.keys(merged.versions).pop() || '0.0.0',
        storageKey: metaPath,
        size: lastAttachmentResult?.size ?? metaResult.size,
        contentHash: lastAttachmentResult?.contentHash ?? metaResult.contentHash
      }
    };
  };

  const download = async (repo: Repository, path: string): Promise<any> => {
    if (repo.type === 'group') {
      const members = repo.config?.members || [];

      if (!context.getRepo) {
        return { ok: false, message: 'Context not ready' };
      }

      for (const id of members) {
        try {
          const m = await context.getRepo(id);
          if (!m) {
            continue;
          }

          if (m.type === 'hosted') {
            const res = await download(m, path);
            if (res.ok) return res;
          } else if (m.type === 'proxy' && proxyFetch) {
            const res = await proxyFetch(m, path);
            if (res.status === 200 || res.status === 304) {
              return {
                ok: true,
                data: res.body,
                contentType: res.headers?.['content-type'] || 'application/octet-stream'
              };
            }
          }
        } catch (err) {
          // ignore error
        }
      }
      return { ok: false, message: 'Not found in group' };
    }

    if (repo.type === 'proxy') {
      if (!proxyFetch) return { ok: false, message: 'Proxy not available' };

      const res = await proxyFetch(repo, path);
      if (res.status === 200 || res.status === 304) {
        return {
          ok: true,
          data: res.body,
          contentType: res.headers?.['content-type'] || 'application/octet-stream'
        };
      }
      return { ok: false, message: 'Not found in upstream' };
    }

    // Hosted logic
    // If path is a package name, read package.json
    const cleanPath = path.split('?')[0].split('#')[0];
    const storagePath = (!cleanPath.includes('/-/') && !cleanPath.endsWith('.tgz'))
      ? `${cleanPath}/package.json`
      : cleanPath;

    const data = await getFile(repo, storagePath);

    if (data) {
      return {
        ok: true,
        data,
        contentType: path.endsWith('.tgz') ? 'application/octet-stream' : 'application/json'
      };
    }
    return { ok: false, message: 'Not found' };
  };

  return {
    saveFile,
    getFile,
    handlePut,
    download
  };
}
