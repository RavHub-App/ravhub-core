import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { LicenseService } from './license.service';

@Injectable()
export class LicenseGuard implements CanActivate {
    constructor(private licenseService: LicenseService, private reflector: Reflector) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const required = this.reflector.get<boolean>('requireLicense', context.getHandler());
        if (!required) return true;

        // In Community edition, hasActiveLicense is always false.
        return this.licenseService.hasActiveLicense();
    }
}
