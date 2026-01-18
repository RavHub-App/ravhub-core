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

import { initMetadata } from 'src/modules/plugins/impl/composer-plugin/proxy/metadata';
import { PluginContext } from 'src/modules/plugins/impl/composer-plugin/utils/types';

describe('ComposerPlugin Metadata', () => {
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
    it('should rewrite URLs relative to repository', async () => {
      const repo = { name: 'composer-proxy', type: 'proxy' } as any;
      const upstream = 'https://packagist.org';

      const input = {
        packages: {},
        'providers-url': '/p/%package%$%hash%.json',
        'metadata-url': '/p2/%package%.json',
        'notify-batch': 'https://packagist.org/downloads/',
      };

      const processed = await metadataMethods.processMetadata(
        repo,
        '/packages.json',
        JSON.stringify(input),
        upstream,
      );

      const json = JSON.parse(processed.toString());

      const expectedBase = 'https://my-registry.com/repository/composer-proxy';

      expect(json['providers-url']).toBe(
        `${expectedBase}/p/%package%$%hash%.json`,
      );
      expect(json['metadata-url']).toBe(`${expectedBase}/p2/%package%.json`);
      expect(json['notify-batch']).toBe(`${expectedBase}/downloads/`);
      // Logic replaces upstreamUrl with repoUrl
    });

    it('should handle buffer input', async () => {
      const repo = { name: 'r1' } as any;
      const buf = Buffer.from(JSON.stringify({ foo: 'bar' }));
      const res = await metadataMethods.processMetadata(repo, 'x', buf, 'up');
      expect(JSON.parse(res.toString()).foo).toBe('bar');
    });
  });
});
