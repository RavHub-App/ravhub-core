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
  constructor(private readonly service: PluginsService) { }

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

    // Try a few possible locations based on how NestJS might have bundled it
    const possiblePaths = [
      path.join(__dirname, 'impl', `${key}-plugin`, 'icon.png'),
      path.join(__dirname, '..', 'impl', `${key}-plugin`, 'icon.png'), // Case if flattened
      path.join(__dirname, '..', '..', 'src', 'modules', 'plugins', 'impl', `${key}-plugin`, 'icon.png'), // Dev fallback
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
    // Import feature definitions
    const { COMMUNITY_FEATURES, ENTERPRISE_FEATURES, FEATURE_CATEGORIES } = await import('../license/features');
    const { LicenseService } = await import('../license/license.service');

    const loadedPlugins = this.service.list().map(p => p.key);

    // Check which features are enabled
    const enabledFeatures: string[] = [];
    const disabledFeatures: string[] = [];

    // All community features are always enabled
    enabledFeatures.push(...COMMUNITY_FEATURES);

    // Check enterprise features
    for (const feature of ENTERPRISE_FEATURES) {
      if (loadedPlugins.includes(feature)) {
        enabledFeatures.push(feature);
      } else {
        disabledFeatures.push(feature);
      }
    }

    return {
      // Plugin-specific info
      plugins: {
        loaded: loadedPlugins,
        community: ['npm', 'pypi', 'docker', 'maven'],
        enterprise: ['nuget', 'composer', 'helm', 'rust', 'raw'],
        restricted: loadedPlugins.length < 9 ? ['nuget', 'composer', 'helm', 'rust', 'raw'].filter(p => !loadedPlugins.includes(p)) : [],
      },
      // All features info
      features: {
        enabled: enabledFeatures,
        disabled: disabledFeatures,
        categories: FEATURE_CATEGORIES,
      },
      // License status
      requiresLicense: loadedPlugins.length < 9,
      edition: loadedPlugins.length < 9 ? 'community' : 'enterprise',
    };
  }
}
