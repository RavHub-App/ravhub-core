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

/**
 * Basic structural tests for Docker Registry Server
 *
 * Note: Full HTTP server behavior is better tested via integration tests.
 * This file validates module structure and exports.
 */

describe('DockerPlugin Registry Server', () => {
  let serverModule: any;

  async function getFreePort() {
    const net = require('net');

    return await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          server.close(() => reject(new Error('failed to resolve free port')));
          return;
        }

        const { port } = address;
        server.close((error: Error | undefined) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
      });
    });
  }

  beforeEach(() => {
    jest.resetModules();
    serverModule = require('src/modules/plugins/impl/docker-plugin/registry/server');
  });

  it('should export startRegistryForRepo function', () => {
    expect(serverModule.startRegistryForRepo).toBeDefined();
    expect(typeof serverModule.startRegistryForRepo).toBe('function');
  });

  it('should export stopRegistryForRepo function', () => {
    expect(serverModule.stopRegistryForRepo).toBeDefined();
    expect(typeof serverModule.stopRegistryForRepo).toBe('function');
  });

  it('should export getRegistryServers function', () => {
    expect(serverModule.getRegistryServers).toBeDefined();
    expect(typeof serverModule.getRegistryServers).toBe('function');
  });

  it('should pass the upload session uuid to appendUpload', async () => {
    process.env.JWT_SECRET = 'test-secret';

    const plugin = {
      appendUpload: jest.fn().mockResolvedValue({ ok: true, uploaded: 5 }),
    };

    const repo = { id: 'repo-1', name: 'docker-hosted-private' };
    const port = await getFreePort();
    const started: any = await serverModule.startRegistryForRepo(
      repo,
      { port },
      { plugin },
    );

    expect(started?.ok).toBe(true);

    const http = require('http');
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        access: [
          { type: 'repository', name: 'ravhub-core', actions: ['push'] },
        ],
      },
      process.env.JWT_SECRET,
    );

    const response = (await new Promise((resolve, reject) => {
      const req = http.request(
        `${started.accessUrl}/v2/ravhub-core/blobs/uploads/session-123`,
        {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            Connection: 'close',
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.write(Buffer.from('hello'));
      req.end();
    })) as any;

    expect(response.status).toBe(202);
    expect(plugin.appendUpload).toHaveBeenCalledWith(
      repo,
      'session-123',
      undefined,
      Buffer.from('hello'),
    );

    await serverModule.stopRegistryForRepo(repo);
  });

  it('should warn and keep raw body when finalize upload receives malformed legacy json', async () => {
    process.env.JWT_SECRET = 'test-secret';

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);
    const plugin = {
      finalizeUpload: jest
        .fn()
        .mockResolvedValue({ ok: true, id: 'sha256:abc' }),
    };

    const repo = { id: 'repo-legacy', name: 'docker-hosted-legacy' };
    const port = await getFreePort();
    const started: any = await serverModule.startRegistryForRepo(
      repo,
      { port },
      { plugin },
    );

    expect(started?.ok).toBe(true);

    const http = require('http');
    const jwt = require('jsonwebtoken');
    const token = jwt.sign(
      {
        access: [
          { type: 'repository', name: 'ravhub-core', actions: ['push'] },
        ],
      },
      process.env.JWT_SECRET,
    );

    const malformedBody = Buffer.from('{"data":"broken-base64"', 'utf8');

    const response = (await new Promise((resolve, reject) => {
      const req = http.request(
        `${started.accessUrl}/v2/ravhub-core/blobs/uploads/session-legacy?digest=sha256:abc`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/octet-stream',
            Connection: 'close',
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.write(malformedBody);
      req.end();
    })) as any;

    expect(response.status).toBe(201);
    expect(plugin.finalizeUpload).toHaveBeenCalledWith(
      repo,
      'ravhub-core',
      'session-legacy',
      'sha256:abc',
      malformedBody,
      undefined,
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to parse legacy upload payload'),
    );

    warnSpy.mockRestore();
    await serverModule.stopRegistryForRepo(repo);
  });

  it('should serve manifest json with digest header and track download', async () => {
    const { createHash } = require('node:crypto');

    const manifestText = JSON.stringify({
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
    });
    const manifestBuffer = Buffer.from(manifestText, 'utf8');
    const plugin = {
      download: jest.fn().mockResolvedValue({ ok: true, data: manifestBuffer }),
      trackDownload: jest.fn().mockResolvedValue(undefined),
    };

    const repo = { id: 'repo-manifest', name: 'docker-hosted-manifest' };
    const port = await getFreePort();
    const started: any = await serverModule.startRegistryForRepo(
      repo,
      { port },
      { plugin },
    );

    expect(started?.ok).toBe(true);

    const http = require('http');
    const response = (await new Promise((resolve, reject) => {
      const req = http.request(
        `${started.accessUrl}/v2/ravhub-core/manifests/latest`,
        {
          method: 'GET',
          headers: {
            Connection: 'close',
          },
        },
        (res: any) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              body: Buffer.concat(chunks).toString('utf8'),
              headers: res.headers,
            });
          });
          res.on('error', reject);
        },
      );

      req.on('error', reject);
      req.end();
    })) as any;

    expect(response.status).toBe(200);
    expect(response.body).toBe(manifestText);
    expect(response.headers['content-type']).toBe(
      'application/vnd.docker.distribution.manifest.v2+json',
    );
    expect(response.headers['docker-content-digest']).toBe(
      `sha256:${createHash('sha256').update(manifestBuffer).digest('hex')}`,
    );
    expect(plugin.download).toHaveBeenCalledWith(repo, 'ravhub-core', 'latest');
    expect(plugin.trackDownload).toHaveBeenCalledWith(
      repo,
      'ravhub-core',
      'latest',
    );

    await serverModule.stopRegistryForRepo(repo);
  });
});
