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

import { initPackages } from 'src/modules/plugins/impl/raw-plugin/packages/list';
import type {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/raw-plugin/utils/types';

jest.mock('src/modules/plugins/impl/raw-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('RawPlugin Packages', () => {
  let mockStorage: {
    exists: jest.Mock;
    save: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
    getUrl: jest.Mock;
  };
  let packageMethods: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      exists: jest.fn(),
      save: jest.fn(),
      get: jest.fn(),
      delete: jest.fn(),
      getUrl: jest.fn(),
    };
    packageMethods = initPackages({
      storage: mockStorage,
    } as unknown as PluginContext);
    jest.clearAllMocks();
  });

  it('should return latest when file exists by repo id', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'raw-repo',
      type: 'hosted',
      manager: 'raw',
    };

    mockStorage.exists.mockResolvedValueOnce(true);

    const result = await packageMethods.listVersions(repo, 'file.txt');

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(['latest']);
  });

  it('should fallback to repo name when id lookup misses', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'raw-repo',
      type: 'hosted',
      manager: 'raw',
    };

    mockStorage.exists.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    const result = await packageMethods.listVersions(repo, 'file.txt');

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(['latest']);
  });

  it('should generate install commands', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'raw-repo',
      type: 'hosted',
      manager: 'raw',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'archive.tgz',
    });

    expect(commands).toHaveLength(3);
    expect(commands[0].command).toContain('curl -O');
    expect(commands[1].command).toContain('wget');
    expect(commands[2].command).toContain('Invoke-WebRequest');
  });

  it('should encode nested raw paths in install commands', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'raw repo',
      type: 'hosted',
      manager: 'raw',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'folder/my file #1.tgz',
    });

    expect(commands[0].command).toContain(
      'http://localhost:3000/repository/raw%20repo/folder/my%20file%20%231.tgz',
    );
    expect(commands[1].command).toContain(
      'http://localhost:3000/repository/raw%20repo/folder/my%20file%20%231.tgz',
    );
    expect(commands[2].command).toContain(
      'http://localhost:3000/repository/raw%20repo/folder/my%20file%20%231.tgz',
    );
  });
});
