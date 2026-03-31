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

import * as crypto from 'crypto';
import * as toml from '@iarna/toml';
import * as tar from 'tar-stream';
import * as zlib from 'zlib';

type CargoDependency = {
  version?: string;
  features?: string[];
  optional?: boolean;
  default_features?: boolean;
};

type CargoManifest = Record<
  string,
  Record<string, string | CargoDependency>
> & {
  features?: Record<string, string[]>;
};

export function getSha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function getIndexPath(name: string): string {
  const lower = name.toLowerCase();
  const len = lower.length;
  if (len === 1) return `1/${lower}`;
  if (len === 2) return `2/${lower}`;
  if (len === 3) return `3/${lower.substring(0, 1)}/${lower}`;
  return `${lower.substring(0, 2)}/${lower.substring(2, 4)}/${lower}`;
}

export async function parseCrateMetadata(buf: Buffer): Promise<CargoManifest> {
  return new Promise<CargoManifest>((resolve) => {
    const extract = tar.extract();
    let cargoData: CargoManifest | null = null;

    extract.on('entry', (header, stream, next) => {
      if (header.name.endsWith('Cargo.toml')) {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => {
          try {
            cargoData = toml.parse(
              Buffer.concat(chunks).toString('utf-8'),
            ) as CargoManifest;
          } catch (error) {
            console.warn(
              `[Rust] Failed to parse Cargo.toml metadata: ${String(error)}`,
            );
          }
          next();
        });
      } else {
        stream.on('end', next);
        stream.resume();
      }
    });

    extract.on('finish', () => resolve(cargoData || {}));
    extract.on('error', () => resolve({}));

    try {
      const gunzip = zlib.createGunzip();
      gunzip.on('error', () => resolve({}));
      gunzip.pipe(extract);
      gunzip.end(buf);
    } catch (error) {
      console.warn(`[Rust] Failed to unpack crate metadata: ${String(error)}`);
      resolve({});
    }
  });
}

export function mapDependencies(
  cargo: CargoManifest,
): Array<Record<string, unknown>> {
  const dependencies: Array<Record<string, unknown>> = [];
  const kinds = [
    { key: 'dependencies', kind: 'normal' },
    { key: 'dev-dependencies', kind: 'dev' },
    { key: 'build-dependencies', kind: 'build' },
  ] as const;

  for (const { key, kind } of kinds) {
    const entries = cargo[key];
    if (!entries) continue;

    for (const [name, value] of Object.entries(entries)) {
      let req = '*';
      let features: string[] = [];
      let optional = false;
      let defaultFeatures = true;

      if (typeof value === 'string') {
        req = value;
      } else if (typeof value === 'object' && value !== null) {
        req = value.version || '*';
        features = value.features || [];
        optional = !!value.optional;
        if (value.default_features === false) {
          defaultFeatures = false;
        }
      }

      dependencies.push({
        name,
        req,
        features,
        optional,
        default_features: defaultFeatures,
        target: null,
        kind,
        package: null,
      });
    }
  }

  return dependencies;
}

export function getBufferFromPkg(pkg: any): Buffer {
  if (pkg?.encoding === 'base64' && typeof pkg.content === 'string') {
    return Buffer.from(pkg.content, 'base64');
  }

  if (Buffer.isBuffer(pkg?.content || pkg?.buffer)) {
    return pkg.content || pkg.buffer;
  }

  return Buffer.from(String(pkg?.content || pkg?.buffer || ''));
}

export async function readRequestBuffer(req: any): Promise<Buffer> {
  if (
    req.body &&
    (Object.keys(req.body).length > 0 || Buffer.isBuffer(req.body))
  ) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'object')
      return Buffer.from(JSON.stringify(req.body));
    return Buffer.from(String(req.body));
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseCratePath(path: string): {
  name: string;
  version: string;
} {
  const filename = path.split('/').pop() || '';
  const match = filename.match(/^(.*)-(\d+\.\d+\.\d+.*)\.crate$/);
  if (!match) {
    return { name: 'crate', version: '0.0.0' };
  }

  return {
    name: match[1],
    version: match[2],
  };
}

export function buildRustConfig(repoName: string): Buffer {
  const host = process.env.API_HOST || 'localhost:3000';
  const proto = process.env.API_PROTOCOL || 'http';
  const baseUrl = `${proto}://${host}/repository/${encodeURIComponent(repoName)}`;

  return Buffer.from(
    JSON.stringify({
      dl: `${baseUrl}/crates/{crate}/{version}/download`,
      api: baseUrl,
    }),
  );
}
