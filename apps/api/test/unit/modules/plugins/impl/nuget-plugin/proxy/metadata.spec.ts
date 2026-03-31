/*
 * Copyright (C) 2026 Rubén Santibáñez Acosta
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

import { initMetadata } from 'src/modules/plugins/impl/nuget-plugin/proxy/metadata';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/nuget-plugin/utils/types';

describe('NuGetPlugin proxy metadata', () => {
  const context = {} as PluginContext;
  const repo = {
    id: 'r1',
    name: 'nuget-proxy',
    type: 'proxy',
  } as Repository;

  beforeEach(() => {
    process.env.API_HOST = 'registry.ravhub.test';
    process.env.API_PROTOCOL = 'https';
  });

  it('rewrites service index resources to v3-proxy URLs', () => {
    const { processServiceIndex } = initMetadata(context);

    const result = processServiceIndex(repo, {
      version: '3.0.0',
      resources: [
        { '@id': 'https://api.nuget.org/v3-flatcontainer/' },
        { '@id': 'https://api.nuget.org/v3/query' },
      ],
    }) as { resources: Array<{ '@id': string }> };

    expect(result.resources[0]['@id']).toBe(
      'https://registry.ravhub.test/repository/nuget-proxy/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3-flatcontainer%2F',
    );
    expect(result.resources[1]['@id']).toBe(
      'https://registry.ravhub.test/repository/nuget-proxy/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3%2Fquery',
    );
  });

  it('returns original content when json parsing fails', () => {
    const { processServiceIndex } = initMetadata(context);
    const invalid = Buffer.from('not valid json');

    const result = processServiceIndex(repo, invalid);

    expect(result).toBe(invalid);
  });

  it('encodes repository names in rewritten service index URLs', () => {
    const { processServiceIndex } = initMetadata(context);
    const encodedRepo = {
      ...repo,
      name: 'nuget proxy#beta',
    } as Repository;

    const result = processServiceIndex(encodedRepo, {
      version: '3.0.0',
      resources: [{ '@id': 'https://api.nuget.org/v3/query' }],
    }) as { resources: Array<{ '@id': string }> };

    expect(result.resources[0]['@id']).toBe(
      'https://registry.ravhub.test/repository/nuget%20proxy%23beta/v3-proxy/https%3A%2F%2Fapi.nuget.org%2Fv3%2Fquery',
    );
  });
});
