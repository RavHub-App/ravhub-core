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

describe('Docker Plugin Helpers (Unit)', () => {
  it('should normalize name for docker hub auto', () => {
    const name = normalizeImageName('alpine', 'https://registry-1.docker.io');
    expect(name).toBe('library/alpine');
  });

  it('should not normalize if namespace present (auto)', () => {
    const name = normalizeImageName(
      'user/alpine',
      'https://registry-1.docker.io',
    );
    expect(name).toBe('user/alpine');
  });

  it('should not normalize for private registry (auto)', () => {
    const name = normalizeImageName('alpine', 'https://myreg.com');
    expect(name).toBe('alpine');
  });

  it('should respect libraryPrefix config disabled', () => {
    const repo = { config: { docker: { libraryPrefix: 'disabled' } } };
    const name = normalizeImageName('alpine', 'https://docker.io', repo);
    expect(name).toBe('alpine');
  });

  it('should respect libraryPrefix config enabled', () => {
    const repo = { config: { docker: { libraryPrefix: 'enabled' } } };
    const name = normalizeImageName('alpine', 'https://private.io', repo);
    expect(name).toBe('library/alpine');
  });

  it('should respect boolean isDockerHub config', () => {
    const repo = { config: { docker: { isDockerHub: true } } };
    const name = normalizeImageName('alpine', 'https://any.com', repo);
    expect(name).toBe('library/alpine');
  });
});
