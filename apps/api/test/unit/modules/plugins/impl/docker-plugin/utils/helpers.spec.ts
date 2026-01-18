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

import { normalizeImageName } from 'src/modules/plugins/impl/docker-plugin/utils/helpers';

describe('DockerPlugin Utils - Helpers', () => {
  describe('normalizeImageName', () => {
    const dockerHubUrl = 'https://registry-1.docker.io';
    const customRegistryUrl = 'https://registry.example.com';

    describe('with libraryPrefix config', () => {
      it('should add library/ for Docker Hub with auto mode', () => {
        const repo = { config: { docker: { libraryPrefix: 'auto' } } };
        const result = normalizeImageName('nginx', dockerHubUrl, repo);
        expect(result).toBe('library/nginx');
      });

      it('should not add library/ for namespaced images', () => {
        const repo = { config: { docker: { libraryPrefix: 'auto' } } };
        const result = normalizeImageName('myorg/nginx', dockerHubUrl, repo);
        expect(result).toBe('myorg/nginx');
      });

      it('should not add library/ for custom registry with auto mode', () => {
        const repo = { config: { docker: { libraryPrefix: 'auto' } } };
        const result = normalizeImageName('nginx', customRegistryUrl, repo);
        expect(result).toBe('nginx');
      });

      it('should always add library/ with enabled mode', () => {
        const repo = { config: { docker: { libraryPrefix: 'enabled' } } };
        const result = normalizeImageName('nginx', customRegistryUrl, repo);
        expect(result).toBe('library/nginx');
      });

      it('should never add library/ with disabled mode', () => {
        const repo = { config: { docker: { libraryPrefix: 'disabled' } } };
        const result = normalizeImageName('nginx', dockerHubUrl, repo);
        expect(result).toBe('nginx');
      });
    });

    describe('with isDockerHub boolean config', () => {
      it('should add library/ when isDockerHub is true', () => {
        const repo = { config: { docker: { isDockerHub: true } } };
        const result = normalizeImageName('nginx', customRegistryUrl, repo);
        expect(result).toBe('library/nginx');
      });

      it('should not add library/ when isDockerHub is false', () => {
        const repo = { config: { docker: { isDockerHub: false } } };
        const result = normalizeImageName('nginx', dockerHubUrl, repo);
        expect(result).toBe('nginx');
      });

      it('should not add library/ for namespaced images even if isDockerHub', () => {
        const repo = { config: { docker: { isDockerHub: true } } };
        const result = normalizeImageName('myorg/nginx', dockerHubUrl, repo);
        expect(result).toBe('myorg/nginx');
      });
    });

    describe('fallback auto-detection', () => {
      it('should detect Docker Hub from registry-1.docker.io', () => {
        const result = normalizeImageName(
          'nginx',
          'https://registry-1.docker.io',
          {},
        );
        expect(result).toBe('library/nginx');
      });

      it('should detect Docker Hub from docker.io', () => {
        const result = normalizeImageName('nginx', 'https://docker.io', {});
        expect(result).toBe('library/nginx');
      });

      it('should not add library/ for custom registry', () => {
        const result = normalizeImageName('nginx', 'https://gcr.io', {});
        expect(result).toBe('nginx');
      });

      it('should handle no repo config', () => {
        const result = normalizeImageName('nginx', dockerHubUrl);
        expect(result).toBe('library/nginx');
      });
    });

    describe('edge cases', () => {
      it('should handle deeply nested namespaces', () => {
        const result = normalizeImageName('org/team/nginx', dockerHubUrl, {});
        expect(result).toBe('org/team/nginx');
      });

      it('should handle empty config', () => {
        const result = normalizeImageName('nginx', dockerHubUrl, {
          config: {},
        });
        expect(result).toBe('library/nginx');
      });

      it('should handle legacy config path', () => {
        const repo = { config: { libraryPrefix: 'enabled' } };
        const result = normalizeImageName('nginx', customRegistryUrl, repo);
        expect(result).toBe('library/nginx');
      });
    });
  });
});
