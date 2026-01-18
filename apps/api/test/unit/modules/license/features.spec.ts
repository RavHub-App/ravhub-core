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
  isCommunityFeature,
  isEnterpriseFeature,
} from 'src/modules/license/features';

describe('License Features (Unit)', () => {
  it('should identify community features', () => {
    expect(isCommunityFeature('npm')).toBe(true);
    expect(isCommunityFeature('docker')).toBe(true);
    expect(isCommunityFeature('storage.s3')).toBe(false);
  });

  it('should identify enterprise features', () => {
    expect(isEnterpriseFeature('storage.s3')).toBe(true);
    expect(isEnterpriseFeature('backup')).toBe(true);
    expect(isEnterpriseFeature('npm')).toBe(false);
  });
});
