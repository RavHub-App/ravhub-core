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
} from 'src/modules/plugins/impl/maven-plugin/utils/key-utils';

describe('MavenPlugin Utils - Key Utils', () => {
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
      const key = buildKey('maven', 'repo1', 'artifact');
      expect(key).toBe('maven/repo1/artifact');
    });

    it('should skip empty segments', () => {
      const key = buildKey('maven', '', 'artifact', null);
      expect(key).toBe('maven/artifact');
    });

    it('should split segments', () => {
      const key = buildKey('maven', 'org/lib');
      expect(key).toBe('maven/org/lib');
    });
  });

  describe('tryNormalizeRepoNames', () => {
    it('should return variants', () => {
      const result = tryNormalizeRepoNames('org/lib');
      expect(result).toContain('org/lib');
      // Check for variants including comma version if implemented similarly
    });

    it('should handle empty input', () => {
      expect(tryNormalizeRepoNames('')).toEqual([]);
      expect(tryNormalizeRepoNames(null)).toEqual([]);
    });
  });

  describe('normalizeStorageKey', () => {
    it('should normalize key', () => {
      expect(normalizeStorageKey('maven/repo////lib')).toBe('maven/repo/lib');
    });
  });
});
