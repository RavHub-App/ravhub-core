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
  sanitizeSegment,
  buildKey,
  tryNormalizeRepoNames,
  normalizeStorageKey,
} from 'src/modules/plugins/impl/pypi-plugin/utils/key-utils';

describe('PyPIPlugin Utils - Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode URI components', () => {
      expect(sanitizeSegment('hello world')).toBe('hello%20world');
    });

    it('should handle empty values', () => {
      expect(sanitizeSegment('')).toBe('');
      expect(sanitizeSegment(null)).toBe('');
    });
  });

  describe('buildKey', () => {
    it('should build key from multiple segments', () => {
      const key = buildKey('pypi', 'simple', 'flask');
      expect(key).toBe('pypi/simple/flask');
    });

    it('should decode and re-encode segments', () => {
      const key = buildKey('pypi', 'my%20package');
      expect(key).toBe('pypi/my%20package');
    });

    it('should split slash-separated input', () => {
      const key = buildKey('pypi', 'org/pkg/version');
      expect(key).toBe('pypi/org/pkg/version');
    });
  });

  describe('tryNormalizeRepoNames', () => {
    it('should return variants', () => {
      const vars = tryNormalizeRepoNames('my/repo');
      expect(vars).toContain('my/repo');
      expect(vars).toContain('my,repo');
    });

    it('should handle empty input', () => {
      expect(tryNormalizeRepoNames('')).toEqual([]);
    });
  });

  describe('normalizeStorageKey', () => {
    it('should normalize mixed separators', () => {
      expect(normalizeStorageKey('pypi/repo,group/pkg')).toBe(
        'pypi/repo/group/pkg',
      );
    });
  });
});
