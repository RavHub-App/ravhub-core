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

import { PermissionsGuard } from 'src/modules/rbac/permissions.guard';
import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';

function makeCtx(req: any): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows superadmin fast-path via x-user-roles header', async () => {
    const reflector: any = { getAllAndOverride: () => ['system.admin'] };
    const guard = new PermissionsGuard(reflector as Reflector);

    const req = {
      method: 'POST',
      url: '/some/endpoint',
      headers: {
        'x-user-roles': 'superadmin',
      },
    };

    const ok = await guard.canActivate(makeCtx(req));
    expect(ok).toBeTruthy();
  });

  it('denies a reader trying to access system.admin permission', async () => {
    const reflector: any = { getAllAndOverride: () => ['system.admin'] };
    const guard = new PermissionsGuard(reflector as Reflector);

    const req = {
      method: 'POST',
      url: '/some/endpoint',
      headers: {
        'x-user-roles': 'reader',
      },
    };

    await expect(guard.canActivate(makeCtx(req))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
