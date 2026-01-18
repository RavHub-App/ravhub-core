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

import { LicenseGuard } from 'src/modules/license/license.guard';

describe('LicenseGuard', () => {
  let guard: LicenseGuard;
  let licenseService: any;
  let reflector: any;

  beforeEach(() => {
    licenseService = { hasActiveLicense: jest.fn() };
    reflector = { get: jest.fn() };
    guard = new LicenseGuard(licenseService, reflector);
  });

  it('should allow if no license required', async () => {
    reflector.get.mockReturnValue(false);
    const can = await guard.canActivate({ getHandler: () => {} } as any);
    expect(can).toBe(true);
  });

  it('should check license if required', async () => {
    reflector.get.mockReturnValue(true);
    licenseService.hasActiveLicense.mockResolvedValue(true);
    const can = await guard.canActivate({ getHandler: () => {} } as any);
    expect(can).toBe(true);
    expect(licenseService.hasActiveLicense).toHaveBeenCalled();
  });

  it('should block if required and no license', async () => {
    reflector.get.mockReturnValue(true);
    licenseService.hasActiveLicense.mockResolvedValue(false);
    const can = await guard.canActivate({ getHandler: () => {} } as any);
    expect(can).toBe(false);
  });
});
