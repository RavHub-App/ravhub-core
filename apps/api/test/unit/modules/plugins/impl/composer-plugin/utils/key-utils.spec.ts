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
} from 'src/modules/plugins/impl/composer-plugin/utils/key-utils';

describe('ComposerPlugin Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode segments', () => {
      expect(sanitizeSegment('foo/bar')).toBe('foo%2Fbar');
      expect(sanitizeSegment('test')).toBe('test');
    });
    it('should handle empty', () => {
      expect(sanitizeSegment(null)).toBe('');
    });
  });

  describe('buildKey', () => {
    it('should join keys with /', () => {
      expect(buildKey('a', 'b')).toBe('a/b');
    });

    it('should handle slashes in segments by splitting them', () => {
      // Logic: seg.split(/\/|,/)
      expect(buildKey('a/b', 'c')).toBe('a/b/c');
      // Wait. buildKey implementation splits input segment by / or , .
      // Then sanitizes parts.
      // 'a/b' -> parts ['a', 'b'] -> sanitize each -> 'a', 'b' -> join /
    });

    it('should sanitize parts', () => {
      expect(buildKey('a@b')).toBe('a%40b');
    });

    it('should ignore empty', () => {
      expect(buildKey('a', '', null, 'b')).toBe('a/b');
    });
  });

  describe('normalizeStorageKey', () => {
    it('should normalize key path', () => {
      const key = 'a/b%2Fc/d';
      // b%2Fc -> decoded 'b/c' -> split -> b, c
      // Result: a/b/c/d
      expect(normalizeStorageKey(key)).toBe('a/b/c/d');
    });
  });
});
