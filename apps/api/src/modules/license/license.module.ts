import { Module } from '@nestjs/common';
import { LicenseService } from './license.service';
import { LicenseGuard } from './license.guard';

@Module({
    providers: [LicenseService, LicenseGuard],
    exports: [LicenseService, LicenseGuard],
})
export class LicenseModule { }
