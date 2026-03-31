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

import { initPackages } from 'src/modules/plugins/impl/pypi-plugin/packages/list';
import type {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/pypi-plugin/utils/types';

jest.mock('src/modules/plugins/impl/pypi-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('PypiPlugin Packages', () => {
  let mockStorage: {
    list: jest.Mock;
    save: jest.Mock;
    get: jest.Mock;
    exists: jest.Mock;
    delete: jest.Mock;
    getUrl: jest.Mock;
  };
  let packageMethods: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn(),
      save: jest.fn(),
      get: jest.fn(),
      exists: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn(),
    };
    packageMethods = initPackages({
      storage: mockStorage,
    } as unknown as PluginContext);
    jest.clearAllMocks();
  });

  it('should collect versions from repo id and repo name keys', async () => {
    mockStorage.list
      .mockResolvedValueOnce(['pypi/r1/requests/1.0.0'])
      .mockResolvedValueOnce(['pypi/pypi-repo/requests/2.0.0']);

    const repo: Repository = {
      id: 'r1',
      name: 'pypi-repo',
      type: 'proxy',
      manager: 'pypi',
    };

    const result = await packageMethods.listVersions(repo, 'requests');

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(expect.arrayContaining(['1.0.0', '2.0.0']));
  });

  it('should generate install commands', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'pypi-repo',
      type: 'hosted',
      manager: 'pypi',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'requests',
      version: '2.32.0',
    });

    expect(commands).toHaveLength(3);
    expect(commands[0].command).toContain('pip install requests==2.32.0');
    expect(commands[1].command).toContain('poetry add requests==2.32.0');
    expect(commands[2].command).toContain('[global]');
  });

  it('should encode repository URLs and quote poetry source names', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'pypi repo#beta',
      type: 'hosted',
      manager: 'pypi',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'requests',
      version: '2.32.0',
    });

    expect(commands[0].command).toContain(
      'http://localhost:3000/repository/pypi%20repo%23beta/simple',
    );
    expect(commands[1].command).toContain(
      'poetry add requests==2.32.0 --source "pypi repo#beta"',
    );
    expect(commands[2].command).toContain(
      'index-url = http://localhost:3000/repository/pypi%20repo%23beta/simple',
    );
  });
});
