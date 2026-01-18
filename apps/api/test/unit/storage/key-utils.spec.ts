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
  tryNormalizeRepoNames,
  buildKey,
  sanitizeSegment,
} from '../../../src/storage/key-utils';

describe('key-utils normalization', () => {
  it('should include comma->slash and slash->comma variants', () => {
    const raw = 'testorg,e2e-image';
    const out = tryNormalizeRepoNames(raw);
    expect(out).toEqual(
      expect.arrayContaining(['testorg,e2e-image', 'testorg/e2e-image']),
    );
  });

  it('should decode encoded segments and include decoded variants', () => {
    const encoded = 'testorg%2Fe2e-image';
    const out = tryNormalizeRepoNames(encoded);
    expect(out).toEqual(
      expect.arrayContaining(['testorg%2Fe2e-image', 'testorg/e2e-image']),
    );
  });

  it('buildKey should split and encode segments consistently', () => {
    const k = buildKey('docker', 'testorg/e2e-image', 'manifests', 'v1');
    // normalized buildKey splits the repo segment into two parts
    expect(k).toBe('docker/testorg/e2e-image/manifests/v1');
  });

  it('sanitizeSegment should url-encode reserved characters', () => {
    const s = sanitizeSegment('a/b,c: d');
    expect(s).toContain('%2F');
    expect(s).toContain('%2C');
    expect(s).toContain('%3A');
  });
});
