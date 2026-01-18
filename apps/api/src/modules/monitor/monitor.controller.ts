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

import { Controller, Get, Query } from '@nestjs/common';
import { MonitorService } from './monitor.service';

@Controller('monitor')
export class MonitorController {
  constructor(private readonly service: MonitorService) {}

  @Get('metrics')
  async metrics(@Query('prefix') prefix?: string) {
    const basic = await this.service.getBasicMetrics();
    const aggregated = await this.service.aggregate(prefix);
    const detailed = await this.service.getDetailedMetrics();
    const recentArtifacts = await this.service.getRecentArtifacts(10);
    return { ...basic, aggregated, ...detailed, recentArtifacts };
  }
}
