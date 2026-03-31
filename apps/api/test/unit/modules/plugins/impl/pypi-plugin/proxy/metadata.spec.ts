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

import { initMetadata } from 'src/modules/plugins/impl/pypi-plugin/proxy/metadata';
import {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/pypi-plugin/utils/types';

describe('PyPIPlugin proxy metadata', () => {
  const context = {} as PluginContext;
  const repo = {
    id: 'r1',
    name: 'pypi-proxy',
    type: 'proxy',
    config: {
      proxyUrl: 'https://pypi.example.test/simple',
    },
  } as Repository;

  beforeEach(() => {
    process.env.API_HOST = 'registry.ravhub.test';
    process.env.API_PROTOCOL = 'https';
  });

  it('rewrites absolute, protocol-relative and relative links through pypi-proxy', () => {
    const { processSimpleIndex } = initMetadata(context);

    const result = processSimpleIndex(
      repo,
      [
        '<html><body>',
        '<a href="https://files.pythonhosted.org/packages/pkg-1.0.0.tar.gz">pkg</a>',
        '<a href="//files.pythonhosted.org/packages/pkg-1.0.1.tar.gz">pkg2</a>',
        '<a href="../../packages/pkg-1.0.2.tar.gz">pkg3</a>',
        '<a href="../local/pkg-1.0.3.whl#sha256=abc">pkg4</a>',
        '</body></html>',
      ].join(''),
      'simple/demo/',
    );

    expect(result).toContain(
      '/repository/pypi-proxy/pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fpkg-1.0.0.tar.gz',
    );
    expect(result).toContain(
      '/repository/pypi-proxy/pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fpkg-1.0.1.tar.gz',
    );
    expect(result).toContain(
      '/repository/pypi-proxy/pypi-proxy/https%3A%2F%2Fpypi.example.test%2Fpackages%2Fpkg-1.0.2.tar.gz',
    );
    expect(result).toContain(
      '/repository/pypi-proxy/pypi-proxy/https%3A%2F%2Fpypi.example.test%2Fsimple%2Flocal%2Fpkg-1.0.3.whl%23sha256%3Dabc',
    );
  });

  it('encodes repository names in rewritten proxy URLs', () => {
    const { processSimpleIndex } = initMetadata(context);
    const encodedRepo = {
      ...repo,
      name: 'pypi proxy#beta',
    } as Repository;

    const result = processSimpleIndex(
      encodedRepo,
      '<html><body><a href="https://files.pythonhosted.org/packages/pkg-1.0.0.tar.gz">pkg</a></body></html>',
      'simple/demo/',
    );

    expect(result).toContain(
      '/repository/pypi%20proxy%23beta/pypi-proxy/https%3A%2F%2Ffiles.pythonhosted.org%2Fpackages%2Fpkg-1.0.0.tar.gz',
    );
  });
});
