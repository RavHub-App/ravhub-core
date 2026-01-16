import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Metric } from '../../entities/metric.entity';
import { Artifact } from '../../entities/artifact.entity';
import { RepositoryEntity } from '../../entities/repository.entity';
import { MonitorController } from './monitor.controller';
import { MonitorService } from './monitor.service';

@Module({
  imports: [TypeOrmModule.forFeature([Metric, Artifact, RepositoryEntity])],
  controllers: [MonitorController],
  providers: [MonitorService],
  exports: [MonitorService],
})
export class MonitorModule {}
