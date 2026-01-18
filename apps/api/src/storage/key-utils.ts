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

export function sanitizeSegment(segment: string | undefined | null): string {
  if (!segment) return '';
  // Use encodeURIComponent to safely encode any path segment
  return encodeURIComponent(String(segment));
}

export function buildKey(
  ...segments: Array<string | undefined | null>
): string {
  // Build a canonical key by splitting input segments on '/' or ',' (and decoding
  // percent-encoded fragments), then encoding each atomic path segment and joining
  // them with a single '/'. This keeps keys consistent across legacy comma
  // separators, encoded slashes and plain slashes.
  const parts: string[] = [];
  for (const segRaw of segments) {
    if (segRaw === undefined || segRaw === null || segRaw === '') continue;
    let seg = String(segRaw);
    // attempt to decode any percent-encoded fragments inside the segment
    try {
      seg = decodeURIComponent(seg);
    } catch (e) {
      /* ignore */
    }
    // break segment into atomic parts by either slash or comma (legacy)
    const sub = seg.split(/\/|,/).filter(Boolean);
    for (const s of sub) {
      parts.push(sanitizeSegment(s));
    }
  }
  return parts.join('/');
}

export function tryNormalizeRepoNames(
  candidate: string | undefined | null,
): string[] {
  if (!candidate) return [];
  const raw = String(candidate);
  const variants = new Set<string>();
  variants.add(raw);
  try {
    // decoded variant (if value was encoded)
    variants.add(decodeURIComponent(raw));
  } catch (e) {
    // ignore decode errors
  }
  // comma → slash legacy mapping (some older code used commas instead of '/')
  if (raw.includes(',')) variants.add(raw.replace(/,/g, '/'));
  // slash → comma fallback (some older storage layouts used commas as path separators)
  if (raw.includes('/')) variants.add(raw.replace(/\//g, ','));
  // if the value was double-encoded or contains encoded commas/slashes, try simple replacements
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded !== raw) {
      variants.add(decoded);
      if (decoded.includes(',')) variants.add(decoded.replace(/,/g, '/'));
    }
  } catch (e) {
    // ignore
  }
  return Array.from(variants);
}

export function normalizeStorageKey(key: string | undefined | null): string {
  if (!key) return '';
  const raw = String(key);
  // Split first on top-level slashes (these are the canonical separators). Each
  // top-level part could itself contain legacy comma separators or encoded
  // characters — try to decode sub-parts and then split by comma and further
  // by any embedded slashes introduced by decoding.
  const outParts: string[] = [];
  const top = raw.split('/');
  for (const t of top) {
    if (!t) continue;
    // legacy comma variants
    const commaParts = t.split(',').filter(Boolean);
    for (const cp of commaParts) {
      // decode any percent-encoding within this token and split if it contains '/'
      let dec = String(cp);
      try {
        dec = decodeURIComponent(dec);
      } catch (e) {
        /* ignore */
      }
      const finalParts = dec.split('/').filter(Boolean);
      for (const f of finalParts) outParts.push(sanitizeSegment(f));
    }
  }
  return outParts.join('/');
}
