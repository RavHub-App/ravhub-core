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

import {
  Controller,
  Get,
  Param,
  Post,
  Body,
  Delete,
  HttpException,
  HttpStatus,
  Res,
} from '@nestjs/common';
import { PluginsService } from './plugins.service';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';

@Controller('plugins')
export class PluginsController {
  constructor(private readonly service: PluginsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':key/icon')
  async getIcon(@Param('key') key: string, @Res() res: Response) {
    const plugin = this.service.getInstance(key);
    if (!plugin) {
      throw new HttpException('Plugin not found', HttpStatus.NOT_FOUND);
    }

    const possiblePaths = [
      path.join(__dirname, 'impl', `${key}-plugin`, 'icon.png'),
      path.join(__dirname, '..', 'impl', `${key}-plugin`, 'icon.png'),
      path.join(
        __dirname,
        '..',
        '..',
        'src',
        'modules',
        'plugins',
        'impl',
        `${key}-plugin`,
        'icon.png',
      ),
    ];

    for (const iconPath of possiblePaths) {
      if (fs.existsSync(iconPath)) {
        return res.sendFile(iconPath);
      }
    }

    throw new HttpException('Icon not found', HttpStatus.NOT_FOUND);
  }

  @Get(':key/ping')
  async ping(@Param('key') key: string) {
    const p = await this.service.ping(key);
    if (!p) return { found: false };
    return { found: true, result: p };
  }

  @Get(':key/schema')
  getSchema(@Param('key') key: string) {
    const plugin = this.service.getInstance(key);
    if (!plugin) return { found: false };
    return { found: true, schema: plugin.metadata.configSchema || {} };
  }

  @Post('reload')
  async reloadPlugins() {
    return await this.service.reloadPlugins();
  }

  @Get('status')
  async getPluginStatus() {
    const { COMMUNITY_FEATURES, ENTERPRISE_FEATURES, FEATURE_CATEGORIES } =
      await import('../license/features');

    const loadedPlugins = this.service.list().map((p) => p.key);

    const enabledFeatures: string[] = [
      ...COMMUNITY_FEATURES,
      ...ENTERPRISE_FEATURES,
    ];
    const disabledFeatures: string[] = [];

    return {
      plugins: {
        loaded: loadedPlugins,
        community: loadedPlugins,
        enterprise: [],
        restricted: [],
      },

      features: {
        enabled: enabledFeatures,
        disabled: disabledFeatures,
        categories: FEATURE_CATEGORIES,
      },

      requiresLicense: false,
      edition: 'community',
    };
  }
}
