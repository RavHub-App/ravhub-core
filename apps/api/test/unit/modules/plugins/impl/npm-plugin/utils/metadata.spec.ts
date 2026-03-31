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

import {
  createInitialMetadata,
  mergeMetadata,
  NpmMetadata,
} from 'src/modules/plugins/impl/npm-plugin/utils/metadata';

describe('NpmPlugin metadata utils', () => {
  it('creates empty initial metadata for a package', () => {
    const result = createInitialMetadata('demo-pkg');

    expect(result).toEqual({
      _id: 'demo-pkg',
      name: 'demo-pkg',
      'dist-tags': {},
      versions: {},
    });
  });

  it('merges versions, dist-tags and descriptive fields', () => {
    const existing: NpmMetadata = {
      _id: 'demo-pkg',
      name: 'demo-pkg',
      description: 'old description',
      readme: 'old readme',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'demo-pkg',
          version: '1.0.0',
        },
      },
    };

    const incoming: NpmMetadata = {
      _id: 'demo-pkg',
      name: 'demo-pkg',
      description: 'new description',
      readme: 'new readme',
      'dist-tags': { beta: '2.0.0-beta.1', latest: '2.0.0' },
      versions: {
        '2.0.0': {
          name: 'demo-pkg',
          version: '2.0.0',
        },
      },
    };

    const result = mergeMetadata(existing, incoming);

    expect(result.description).toBe('new description');
    expect(result.readme).toBe('new readme');
    expect(result['dist-tags']).toEqual({
      latest: '2.0.0',
      beta: '2.0.0-beta.1',
    });
    expect(result.versions).toEqual({
      '1.0.0': {
        name: 'demo-pkg',
        version: '1.0.0',
      },
      '2.0.0': {
        name: 'demo-pkg',
        version: '2.0.0',
      },
    });
  });

  it('keeps existing fields when incoming metadata omits them', () => {
    const existing: NpmMetadata = {
      _id: 'demo-pkg',
      name: 'demo-pkg',
      description: 'stable description',
      readme: 'stable readme',
      'dist-tags': { latest: '1.0.0' },
      versions: {
        '1.0.0': {
          name: 'demo-pkg',
          version: '1.0.0',
        },
      },
    };

    const incoming: NpmMetadata = {
      _id: 'demo-pkg',
      name: 'demo-pkg',
      'dist-tags': {},
      versions: {},
    };

    const result = mergeMetadata(existing, incoming);

    expect(result.description).toBe('stable description');
    expect(result.readme).toBe('stable readme');
    expect(result['dist-tags']).toEqual({ latest: '1.0.0' });
    expect(result.versions).toEqual(existing.versions);
  });
});
