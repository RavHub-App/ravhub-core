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
} from 'src/modules/plugins/impl/docker-plugin/utils/key-utils';

describe('DockerPlugin Utils - Key Utils', () => {
  describe('sanitizeSegment', () => {
    it('should encode URI components', () => {
      expect(sanitizeSegment('hello world')).toBe('hello%20world');
    });

    it('should handle special characters', () => {
      expect(sanitizeSegment('image:tag')).toBe('image%3Atag');
    });

    it('should handle empty values', () => {
      expect(sanitizeSegment('')).toBe('');
      expect(sanitizeSegment(null)).toBe('');
      expect(sanitizeSegment(undefined)).toBe('');
    });

    it('should convert to string', () => {
      expect(sanitizeSegment(123)).toBe('123');
    });
  });

  describe('buildKey', () => {
    it('should build key from multiple segments', () => {
      const key = buildKey('docker', 'repo1', 'nginx', 'latest');
      expect(key).toBe('docker/repo1/nginx/latest');
    });

    it('should skip empty segments', () => {
      const key = buildKey('docker', '', 'nginx', null, 'latest');
      expect(key).toBe('docker/nginx/latest');
    });

    it('should split segments with slashes', () => {
      const key = buildKey('docker', 'org/image', 'tag');
      expect(key).toBe('docker/org/image/tag');
    });

    it('should split segments with commas', () => {
      const key = buildKey('docker', 'org,image', 'tag');
      expect(key).toBe('docker/org/image/tag');
    });

    it('should decode URI components', () => {
      const key = buildKey('docker', 'repo%201', 'image');
      expect(key).toBe('docker/repo%201/image');
    });

    it('should handle all empty segments', () => {
      const key = buildKey('', null, undefined);
      expect(key).toBe('');
    });
  });

  describe('tryNormalizeRepoNames', () => {
    it('should return original value', () => {
      const result = tryNormalizeRepoNames('nginx');
      expect(result).toContain('nginx');
    });

    it('should include decoded variant', () => {
      const result = tryNormalizeRepoNames('nginx%20image');
      expect(result).toContain('nginx image');
    });

    it('should convert commas to slashes', () => {
      const result = tryNormalizeRepoNames('org,image');
      expect(result).toContain('org/image');
    });

    it('should convert slashes to commas', () => {
      const result = tryNormalizeRepoNames('org/image');
      expect(result.some((v) => v.includes(','))).toBe(true);
    });

    it('should handle empty input', () => {
      const result = tryNormalizeRepoNames('');
      expect(result).toEqual([]);
    });

    it('should handle null input', () => {
      const result = tryNormalizeRepoNames(null);
      expect(result).toEqual([]);
    });

    it('should return unique variants', () => {
      const result = tryNormalizeRepoNames('nginx');
      const unique = new Set(result);
      expect(result.length).toBe(unique.size);
    });
  });

  describe('normalizeStorageKey', () => {
    it('should normalize simple key', () => {
      const result = normalizeStorageKey('docker/repo/image');
      expect(result).toBe('docker/repo/image');
    });

    it('should handle commas in segments', () => {
      const result = normalizeStorageKey('docker/org,image/tag');
      expect(result).toBe('docker/org/image/tag');
    });

    it('should decode URI components', () => {
      const result = normalizeStorageKey('docker/repo%201/image');
      expect(result).toBe('docker/repo%201/image');
    });

    it('should handle nested slashes', () => {
      const result = normalizeStorageKey('docker/org/team/image');
      expect(result).toBe('docker/org/team/image');
    });

    it('should filter empty segments', () => {
      const result = normalizeStorageKey('docker//repo///image');
      expect(result).toBe('docker/repo/image');
    });

    it('should handle empty input', () => {
      const result = normalizeStorageKey('');
      expect(result).toBe('');
    });

    it('should handle complex mixed separators', () => {
      const result = normalizeStorageKey('docker/org,team/image');
      expect(result).toBe('docker/org/team/image');
    });
  });
});
