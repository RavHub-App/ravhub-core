import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StorageConfig } from '../../entities/storage-config.entity';
import { StorageService } from './storage.service';
import { StorageConfigController } from './storage-config.controller';
import { StorageConfigService } from './storage-config.service';
import { AuditModule } from '../audit/audit.module';
import { LicenseModule } from '../license/license.module';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([StorageConfig]),
    forwardRef(() => AuditModule),
    forwardRef(() => LicenseModule),
    RedisModule,
  ],
  controllers: [StorageConfigController],
  providers: [StorageService, StorageConfigService],
  exports: [StorageService, StorageConfigService],
})
export class StorageModule { }
