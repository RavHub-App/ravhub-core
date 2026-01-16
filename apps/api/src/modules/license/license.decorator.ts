import { SetMetadata, UseGuards, applyDecorators } from '@nestjs/common';
import { LicenseGuard } from './license.guard';

export const RequireLicense = () => {
    return applyDecorators(
        SetMetadata('requireLicense', true),
        UseGuards(LicenseGuard)
    );
};
