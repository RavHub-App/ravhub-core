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
} from 'src/modules/plugins/impl/npm-plugin/utils/key-utils';

describe('NpmPlugin Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode URI components', () => {
      expect(sanitizeSegment('test/path')).toBe('test%2Fpath');
      expect(sanitizeSegment('@scope/package')).toBe('%40scope%2Fpackage');
    });

    it('should handle empty values', () => {
      expect(sanitizeSegment('')).toBe('');
      expect(sanitizeSegment(null)).toBe('');
    });
  });

  describe('buildKey', () => {
    it('should build key from segments', () => {
      const key = buildKey('npm', 'repo1', 'package', '1.0.0');
      expect(key).toBe('npm/repo1/package/1.0.0');
    });

    it('should handle encoded segments', () => {
      const key = buildKey('npm', 'repo1', '@scope/package');
      expect(key).toContain('%40scope');
    });

    it('should skip empty segments', () => {
      const key = buildKey('npm', '', 'package', null, '1.0.0');
      expect(key).toBe('npm/package/1.0.0');
    });
  });

  describe('normalizeStorageKey', () => {
    it('should normalize storage keys', () => {
      const normalized = normalizeStorageKey('npm/repo/package');
      expect(normalized).toBe('npm/repo/package');
    });
  });

  describe('tryNormalizeRepoNames', () => {
    it('should generate name variants', () => {
      const variants = tryNormalizeRepoNames('test/repo');
      expect(variants).toContain('test/repo');
      expect(variants).toContain('test,repo');
    });
  });
});
