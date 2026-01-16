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
