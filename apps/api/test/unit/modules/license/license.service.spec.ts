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

import { LicenseService } from 'src/modules/license/license.service';

describe('LicenseService (Unit)', () => {
  let service: LicenseService;

  beforeEach(() => {
    service = new LicenseService();
  });

  it('should check if feature is enabled', () => {
    expect(service.isFeatureEnabled('npm')).toBe(true);
    expect(service.isFeatureEnabled('invalid')).toBe(false);
  });

  it('should return license info', () => {
    const info = service.getLicenseInfo();
    expect(info.type).toBe('community');
    expect(info.active).toBe(false);
  });

  it('should always return false for hasActiveLicense in community version', async () => {
    expect(await service.hasActiveLicense()).toBe(false);
  });
});
