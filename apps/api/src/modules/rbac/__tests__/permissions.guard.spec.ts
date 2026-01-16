import { PermissionsGuard } from '../permissions.guard';
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
