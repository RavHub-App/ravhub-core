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

import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from '../../src/app.controller';
import { AppService, AppInfo } from '../../src/app.service';
import { PluginsService } from '../../src/modules/plugins/plugins.service';

describe('AppController', () => {
  let appController: AppController;

  const mockPluginsService = {
    list: jest.fn().mockReturnValue([{ key: 'npm' }, { key: 'docker' }]),
  };

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        { provide: PluginsService, useValue: mockPluginsService },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return app info', () => {
      const result: AppInfo = appController.getInfo();

      expect(result).toHaveProperty('name', 'RavHub');
      expect(result).toHaveProperty('version');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('nodeVersion');
      expect(result).toHaveProperty('environment');
      expect(result).toHaveProperty('plugins');
      expect(result.plugins.total).toBe(2);
      expect(result.plugins.loaded).toContain('npm');
      expect(result.plugins.loaded).toContain('docker');
    });
  });
});
