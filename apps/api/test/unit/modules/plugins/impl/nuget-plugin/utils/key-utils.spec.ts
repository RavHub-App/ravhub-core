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
} from 'src/modules/plugins/impl/nuget-plugin/utils/key-utils';

describe('NuGetPlugin Utils - Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode URI components', () => {
      expect(sanitizeSegment('hello world')).toBe('hello%20world');
    });
  });

  describe('buildKey', () => {
    it('should build key from multiple segments', () => {
      const key = buildKey('nuget', 'v3', 'package');
      expect(key).toBe('nuget/v3/package');
    });
  });
});
