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

import { Injectable } from '@nestjs/common';

@Injectable()
export class LicenseService {
  isFeatureEnabled(feature: string): boolean {
    const communityFeatures = [
      'npm',
      'maven',
      'docker',
      'pypi',
      'nuget',
      'composer',
      'helm',
      'rust',
      'raw',
    ];
    return communityFeatures.includes(feature);
  }

  getLicenseInfo() {
    return { type: 'community', active: false };
  }

  async hasActiveLicense(): Promise<boolean> {
    return false;
  }
}
