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
} from 'src/modules/plugins/impl/helm-plugin/utils/key-utils';

describe('HelmPlugin Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode URI components', () => {
      expect(sanitizeSegment('chart/name')).toBe('chart%2Fname');
    });

    it('should handle empty values', () => {
      expect(sanitizeSegment('')).toBe('');
      expect(sanitizeSegment(null)).toBe('');
    });
  });

  describe('buildKey', () => {
    it('should build key from segments', () => {
      const key = buildKey('helm', 'repo1', 'chart', '1.0.0');
      expect(key).toBe('helm/repo1/chart/1.0.0');
    });

    it('should skip empty segments', () => {
      const key = buildKey('helm', '', 'chart', null, '1.0.0');
      expect(key).toBe('helm/chart/1.0.0');
    });
  });
});
