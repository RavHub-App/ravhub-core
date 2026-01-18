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

import {
  buildKey,
  sanitizeSegment,
  normalizeStorageKey,
  tryNormalizeRepoNames,
} from 'src/modules/plugins/impl/composer-plugin/utils/key-utils';

describe('Composer Key Utils (Unit)', () => {
  it('should sanitize segment', () => {
    expect(sanitizeSegment('foo/bar')).toBe('foo%2Fbar');
    expect(sanitizeSegment('foo,bar')).toBe('foo%2Cbar');
    expect(sanitizeSegment(null)).toBe('');
  });

  it('should build key from segments', () => {
    // Implementation logic: split by / or , and filter boolean, then join with /
    // Wait, review impl:
    // for seg of segments:
    //   sub = seg.split(/\/|,/)
    //   parts.push(sanitize(s))

    const k = buildKey('composer', 'r1', 'vendor/pkg');
    // 'vendor/pkg' -> split -> 'vendor', 'pkg' -> 'vendor/pkg'
    expect(k).toBe('composer/r1/vendor/pkg');
  });

  it('should normalize storage key', () => {
    const k = 'composer/r1/vendor%2Fpkg';
    // impl decode and resplit
    const n = normalizeStorageKey(k);
    expect(n).toBe('composer/r1/vendor/pkg');
  });

  it('should normalize repo names variants', () => {
    const variants = tryNormalizeRepoNames('a/b');
    expect(variants).toContain('a/b');
    expect(variants).toContain('a,b');
  });
});
