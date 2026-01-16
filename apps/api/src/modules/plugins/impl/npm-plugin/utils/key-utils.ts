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
    } catch (e) { /* ignore */ }
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
  } catch (e) { }
  if (raw.includes(',')) variants.add(raw.replace(/,/g, '/'));
  if (raw.includes('/')) variants.add(raw.replace(/[/]/g, ','));
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
      try { dec = decodeURIComponent(dec); } catch (e) { }
      const finalParts = dec.split('/').filter(Boolean);
      for (const f of finalParts) outParts.push(sanitizeSegment(f));
    }
  }
  return outParts.join('/');
}
