import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

type ManifestPayloadResult = {
  url?: string;
  data?: Buffer | string;
  body?: Buffer | string;
};

export async function resolveManifestFileContentType(
  result: ManifestPayloadResult,
  name: string,
  tag: string,
) {
  if (!result.url || !result.url.startsWith('file://')) {
    return 'application/octet-stream';
  }

  try {
    const buffer = await fs.readFile(result.url.replace(/^file:\/\//, ''));
    return detectManifestContentType(buffer);
  } catch (error) {
    console.warn(
      `[REGISTRY] Failed to inspect manifest content type for ${name}:${tag}: ${String(error)}`,
    );
    return 'application/octet-stream';
  }
}

export async function resolveManifestResponsePayload(
  result: ManifestPayloadResult,
  name: string,
  tag: string,
  chosenVersion: 'v2',
) {
  const buffer = await readManifestBuffer(result);
  const contentType = detectManifestContentType(buffer, name, tag);
  const responseBody = contentType.includes('json')
    ? buffer.toString('utf8')
    : buffer;

  return {
    contentType,
    responseBody,
    digestHeader:
      contentType.includes('json') && chosenVersion === 'v2'
        ? `sha256:${createHash('sha256').update(buffer).digest('hex')}`
        : null,
  };
}

async function readManifestBuffer(result: ManifestPayloadResult) {
  if (result.data || result.body) {
    const rawBody = result.data || result.body;
    if (!rawBody) {
      throw new Error('empty manifest body');
    }

    return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  }

  if (!result.url) {
    throw new Error('missing manifest url');
  }

  return fs.readFile(result.url.replace(/^file:\/\//, ''));
}

function detectManifestContentType(
  buffer: Buffer,
  name?: string,
  tag?: string,
) {
  try {
    const text = buffer.toString('utf8');
    if (
      !(text && (text.trim().startsWith('{') || text.trim().startsWith('[')))
    ) {
      return 'application/octet-stream';
    }

    const parsedManifest = JSON.parse(text) as { mediaType?: string };
    return parsedManifest.mediaType || 'application/json';
  } catch (error) {
    if (name && tag) {
      console.warn(
        `[REGISTRY] Failed to inspect manifest body for ${name}:${tag}: ${String(error)}`,
      );
    }

    return 'application/octet-stream';
  }
}
