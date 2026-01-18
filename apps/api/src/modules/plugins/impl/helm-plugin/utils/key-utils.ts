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

export function sanitizeSegment(segment) {
  if (!segment) return '';
  return encodeURIComponent(String(segment));
}

export function buildKey(...segments) {
  const parts: string[] = [];
  for (const segRaw of segments) {
    if (segRaw === undefined || segRaw === null || segRaw === '') continue;
    let seg = String(segRaw);

    // Decode URI components to ensure we split by actual slashes, not encoded ones.
    // This creates a deep directory structure which avoids filename length limits.
    try {
      seg = decodeURIComponent(seg);
    } catch (e) {
      /* ignore */
    }

    const sub = seg.split(/\/|,/).filter(Boolean);
    for (const s of sub) {
      parts.push(sanitizeSegment(s));
    }
  }
  return parts.join('/');
}

export function tryNormalizeRepoNames(candidate) {
  if (!candidate) return [];
  const raw = String(candidate);
  const variants = new Set();
  variants.add(raw);
  try {
    variants.add(decodeURIComponent(raw));
  } catch (e) {}
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
    const commaParts = t.split(',').filter(Boolean);
    for (const cp of commaParts) {
      let dec = String(cp);
      try {
        dec = decodeURIComponent(dec);
      } catch (e) {}
      const finalParts = dec.split('/').filter(Boolean);
      for (const f of finalParts) outParts.push(sanitizeSegment(f));
    }
  }
  return outParts.join('/');
}
