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
import { PluginsService } from './modules/plugins/plugins.service';

export interface AppInfo {
  name: string;
  version: string;
  description: string;
  uptime: number;
  nodeVersion: string;
  environment: string;
  plugins: {
    total: number;
    loaded: string[];
  };
}

@Injectable()
export class AppService {
  private readonly startTime = Date.now();

  constructor(private readonly pluginsService: PluginsService) {}

  getInfo(): AppInfo {
    const plugins = this.pluginsService.list();

    return {
      name: 'RavHub',
      version: process.env.npm_package_version || '1.0.0',
      description:
        'Self-hosted package registry for Docker, NPM, Maven, PyPI, NuGet, Composer, Rust, Helm and more',
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      plugins: {
        total: plugins.length,
        loaded: plugins.map((p) => p.key),
      },
    };
  }
}
