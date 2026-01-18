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

import { PluginManagerService } from 'src/modules/plugins/plugin-manager.service';
import { UpstreamPingService } from 'src/modules/plugins/upstream-ping.service';
import { PluginDelegatorService } from 'src/modules/plugins/plugin-delegator.service';
import { ProxyCacheJobService } from 'src/modules/plugins/proxy-cache-job.service';

describe('PluginManagerService (Unit)', () => {
  let service: PluginManagerService;
  let upstreamPingService: jest.Mocked<UpstreamPingService>;
  let pluginDelegatorService: jest.Mocked<PluginDelegatorService>;
  let proxyCacheJobService: jest.Mocked<ProxyCacheJobService>;

  beforeEach(() => {
    upstreamPingService = {
      startUpstreamPingScheduler: jest.fn(),
    } as any;
    pluginDelegatorService = {} as any;
    proxyCacheJobService = {
      startJobProcessor: jest.fn(),
      startProxyCacheCleanupScheduler: jest.fn(),
    } as any;

    service = new PluginManagerService(
      upstreamPingService,
      pluginDelegatorService,
      proxyCacheJobService,
    );
  });

  describe('onModuleInit', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should start schedulers and job processor', async () => {
      await service.onModuleInit();

      jest.runAllTimers();

      expect(proxyCacheJobService.startJobProcessor).toHaveBeenCalled();
      expect(upstreamPingService.startUpstreamPingScheduler).toHaveBeenCalled();
      expect(
        proxyCacheJobService.startProxyCacheCleanupScheduler,
      ).toHaveBeenCalled();
    });
  });
});
