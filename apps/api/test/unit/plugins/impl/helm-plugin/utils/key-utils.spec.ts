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
} from 'src/modules/plugins/impl/helm-plugin/utils/key-utils';

describe('Helm Key Utils (Unit)', () => {
  it('should sanitize segment', () => {
    expect(sanitizeSegment('foo/bar')).toBe('foo%2Fbar');
  });

  it('should build key from segments', () => {
    const k = buildKey('helm', 'r1', 'charts/pkg');
    expect(k).toBe('helm/r1/charts/pkg');
  });

  it('should normalize storage key', () => {
    const k = 'helm/r1/charts%2Fpkg';
    const n = normalizeStorageKey(k);
    expect(n).toBe('helm/r1/charts/pkg');
  });

  it('should normalize repo names variants', () => {
    const variants = tryNormalizeRepoNames('a/b');
    expect(variants).toContain('a/b');
  });
});
