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

import { initMetadata } from 'src/modules/plugins/impl/npm-plugin/proxy/metadata';
import { Repository } from 'src/modules/plugins/impl/npm-plugin/utils/types';

describe('NpmPlugin Metadata', () => {
  let metadataMethods: ReturnType<typeof initMetadata>;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...ORIGINAL_ENV,
      API_HOST: 'my-registry.com',
      API_PROTOCOL: 'https',
    };
    metadataMethods = initMetadata({} as any);
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('processMetadata', () => {
    const repo: Repository = {
      name: 'npm-proxy',
      type: 'proxy',
      config: { proxyUrl: 'https://registry.npmjs.org', rewriteTarballs: true },
    } as any;

    it('should rewrite tarball URLs in versions', () => {
      const metadata = {
        name: 'test-pkg',
        versions: {
          '1.0.0': {
            dist: {
              tarball:
                'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
            },
          },
        },
      };

      const result = metadataMethods.processMetadata(repo, metadata);

      expect(result.versions['1.0.0'].dist.tarball).toBe(
        'https://my-registry.com/repository/npm-proxy/test-pkg/-/test-pkg-1.0.0.tgz',
      );
    });

    it('should handle buffer input', () => {
      const metadata = {
        name: 'test-pkg',
        versions: {
          '1.0.0': {
            dist: {
              tarball:
                'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz',
            },
          },
        },
      };
      const buffer = Buffer.from(JSON.stringify(metadata));

      const result = metadataMethods.processMetadata(repo, buffer);

      expect(result.versions['1.0.0'].dist.tarball).toContain(
        'my-registry.com',
      );
    });

    it('should handle string input', () => {
      const metadata = JSON.stringify({
        name: 'test-pkg',
        versions: {},
      });

      const result = metadataMethods.processMetadata(repo, metadata);

      expect(result.name).toBe('test-pkg');
    });

    it('should not rewrite if rewriteTarballs is false', () => {
      const noRewriteRepo = {
        ...repo,
        config: { ...repo.config, rewriteTarballs: false },
      };
      const originalUrl =
        'https://registry.npmjs.org/test-pkg/-/test-pkg-1.0.0.tgz';
      const metadata = {
        versions: {
          '1.0.0': {
            dist: { tarball: originalUrl },
          },
        },
      };

      const result = metadataMethods.processMetadata(
        noRewriteRepo as any,
        metadata,
      );

      expect(result.versions['1.0.0'].dist.tarball).toBe(originalUrl);
    });

    it('should handle aggressive rewrite for non-upstream URLs', () => {
      const metadata = {
        versions: {
          '1.0.0': {
            dist: {
              tarball: 'https://other-cdn.com/test-pkg/-/test-pkg-1.0.0.tgz',
            },
          },
        },
      };

      const result = metadataMethods.processMetadata(repo, metadata);

      expect(result.versions['1.0.0'].dist.tarball).toContain(
        'my-registry.com',
      );
    });

    it('should handle invalid JSON gracefully', () => {
      const invalidJson = 'not valid json';

      const result = metadataMethods.processMetadata(repo, invalidJson);

      expect(result).toBe(invalidJson);
    });

    it('should avoid double prefixing repository path', () => {
      const metadata = {
        versions: {
          '1.0.0': {
            dist: {
              tarball:
                'https://other.com/repository/npm-proxy/test-pkg/-/test-pkg-1.0.0.tgz',
            },
          },
        },
      };

      const result = metadataMethods.processMetadata(repo, metadata);

      const tarball = result.versions['1.0.0'].dist.tarball;
      expect(tarball).not.toContain(
        'repository/npm-proxy/repository/npm-proxy',
      );
    });
  });
});
