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

function isProbablyBase64(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 16) return false;
  if (trimmed.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(trimmed);
}

export function getContentBuffer(pkg: any): Buffer {
  if (pkg?.buffer && Buffer.isBuffer(pkg.buffer)) return pkg.buffer;
  if (pkg?.buffer?.type === 'Buffer' && Array.isArray(pkg.buffer.data)) {
    return Buffer.from(pkg.buffer.data);
  }

  const raw = pkg?.content ?? pkg?.data;

  if (pkg?.encoding === 'base64' && typeof raw === 'string') {
    return Buffer.from(raw, 'base64');
  }

  if (Buffer.isBuffer(raw)) return raw;
  if (typeof raw === 'string') {
    if (isProbablyBase64(raw)) {
      try {
        const decoded = Buffer.from(raw, 'base64');
        const normalizedDecoded = decoded.toString('base64').replace(/=+$/, '');
        const normalizedInput = raw.trim().replace(/=+$/, '');
        if (normalizedDecoded === normalizedInput) return decoded;
      } catch {
        return Buffer.from(raw);
      }
    }
    return Buffer.from(raw);
  }

  return Buffer.from(JSON.stringify(pkg ?? {}));
}

export function getContentTypeByPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.pom') || lower.endsWith('.xml')) {
    return 'application/xml';
  }
  if (lower.endsWith('.jar')) return 'application/java-archive';
  if (lower.endsWith('.aar')) return 'application/octet-stream';
  if (
    lower.endsWith('.sha1') ||
    lower.endsWith('.md5') ||
    lower.endsWith('.sha256')
  ) {
    return 'text/plain';
  }
  if (lower.endsWith('.asc')) return 'application/pgp-signature';
  return 'application/octet-stream';
}

export function checksumAlgoForPath(
  path: string,
): 'sha1' | 'md5' | 'sha256' | null {
  const lower = path.toLowerCase();
  if (lower.endsWith('.sha1')) return 'sha1';
  if (lower.endsWith('.md5')) return 'md5';
  if (lower.endsWith('.sha256')) return 'sha256';
  return null;
}

export function stripChecksumExt(path: string): string {
  if (path.toLowerCase().endsWith('.sha1')) return path.slice(0, -5);
  if (path.toLowerCase().endsWith('.md5')) return path.slice(0, -4);
  if (path.toLowerCase().endsWith('.sha256')) return path.slice(0, -7);
  return path;
}

export async function streamToBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    req.on('data', (chunk: Buffer) =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
    );
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
