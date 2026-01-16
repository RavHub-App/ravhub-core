import { Injectable } from '@nestjs/common';

@Injectable()
export class LicenseService {
    isFeatureEnabled(feature: string): boolean {
        const communityFeatures = ['npm', 'maven', 'docker', 'pypi'];
        return communityFeatures.includes(feature);
    }

    getLicenseInfo() {
        return { type: 'community', active: false };
    }

    async hasActiveLicense(): Promise<boolean> {
        return false;
    }
}
