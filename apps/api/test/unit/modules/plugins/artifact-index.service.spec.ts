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

import { ArtifactIndexService } from 'src/modules/plugins/artifact-index.service';

describe('ArtifactIndexService (Unit)', () => {
  let service: ArtifactIndexService;

  beforeEach(() => {
    service = new ArtifactIndexService();
  });

  describe('indexArtifact', () => {
    it('should queue artifact if DB not initialized', async () => {
      const repo = { id: 'repo1', manager: 'npm' };
      const result = { metadata: { packageName: 'test', version: '1.0.0' } };

      await service.indexArtifact(repo as any, result, 'user1');

      expect((service as any).pendingArtifacts).toHaveLength(1);
      expect((service as any).pendingArtifacts[0].result).toBe(result);
    });

    it('should skip silently if no metadata provided', async () => {
      const repo = { id: 'repo1', manager: 'npm' };
      const result = {};

      await expect(
        service.indexArtifact(repo as any, result),
      ).resolves.toBeUndefined();
    });
  });

  describe('flushPendingArtifacts', () => {
    it('should not throw if no pending artifacts', async () => {
      await expect(service.flushPendingArtifacts()).resolves.not.toThrow();
    });
  });
});
