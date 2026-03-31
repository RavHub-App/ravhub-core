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

export function sanitizeSegment(segment) {
  if (!segment) return '';
  return encodeURIComponent(String(segment));
}

export function buildKey(...segments) {
  const parts: string[] = [];
  for (const segRaw of segments) {
    if (segRaw === undefined || segRaw === null || segRaw === '') continue;
    let seg = String(segRaw);
    try {
      seg = decodeURIComponent(seg);
    } catch (e) {
      warnDecodeFailure('buildKey segment', seg, e);
    }
    const sub = seg.split('/').filter(Boolean);
    for (const s of sub) {
      parts.push(sanitizeSegment(s));
    }
  }
  return parts.join('/');
}

function warnDecodeFailure(operation: string, value: string, error: unknown) {
  console.warn(
    `[RawPlugin KeyUtils] Failed to decode ${operation} "${value}": ${String(error)}`,
  );
}

export function tryNormalizeRepoNames(candidate) {
  if (!candidate) return [];
  const raw = String(candidate);
  const variants = new Set();
  variants.add(raw);
  try {
    variants.add(decodeURIComponent(raw));
  } catch (e) {
    warnDecodeFailure('repository name', raw, e);
  }
  if (raw.includes(',')) variants.add(raw.replace(/,/g, '/'));
  if (raw.includes('/')) variants.add(raw.replace(/[ / ]/g, ','));
  return Array.from(variants);
}

export function normalizeStorageKey(key) {
  if (!key) return '';
  const raw = String(key);
  const outParts: string[] = [];
  const top = raw.split('/');
  for (const t of top) {
    if (!t) continue;
    let dec = String(t);
    try {
      dec = decodeURIComponent(dec);
    } catch (e) {
      warnDecodeFailure('storage key segment', dec, e);
    }
    const finalParts = dec.split('/').filter(Boolean);
    for (const f of finalParts) outParts.push(sanitizeSegment(f));
  }
  return outParts.join('/');
}
