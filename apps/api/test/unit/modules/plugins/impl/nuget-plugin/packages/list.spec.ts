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

import { initPackages } from 'src/modules/plugins/impl/nuget-plugin/packages/list';
import type {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/nuget-plugin/utils/types';

jest.mock('src/modules/plugins/impl/nuget-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('NugetPlugin Packages', () => {
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

  it('should collect versions from stored package paths', async () => {
    mockStorage.list
      .mockResolvedValueOnce(['nuget/r1/Newtonsoft.Json/13.0.3/file.nupkg'])
      .mockResolvedValueOnce([
        'nuget/nuget-repo/Newtonsoft.Json/13.0.4/file.nupkg',
      ]);

    const repo: Repository = {
      id: 'r1',
      name: 'nuget-repo',
      type: 'proxy',
      manager: 'nuget',
    };

    const result = await packageMethods.listVersions(repo, 'Newtonsoft.Json');

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(
      expect.arrayContaining(['13.0.3', '13.0.4']),
    );
  });

  it('should collect versions from proxy cached package paths', async () => {
    mockStorage.list
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        'nuget/r1/proxy/Newtonsoft.Json/13.0.5/Newtonsoft.Json.13.0.5.nupkg',
      ])
      .mockResolvedValueOnce([]);

    const repo: Repository = {
      id: 'r1',
      name: 'nuget-proxy',
      type: 'proxy',
      manager: 'nuget',
    };

    const result = await packageMethods.listVersions(repo, 'Newtonsoft.Json');

    expect(result.ok).toBe(true);
    expect(result.versions).toContain('13.0.5');
  });

  it('should generate install commands', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'nuget-repo',
      type: 'hosted',
      manager: 'nuget',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'Newtonsoft.Json',
      version: '13.0.3',
    });

    expect(commands).toHaveLength(4);
    expect(commands[0].command).toContain('dotnet add package Newtonsoft.Json');
    expect(commands[1].command).toContain('nuget install Newtonsoft.Json');
    expect(commands[3].command).toContain('<configuration>');
  });

  it('should encode repository name in install source URLs', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'nuget repo#1',
      type: 'hosted',
      manager: 'nuget',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'Newtonsoft.Json',
      version: '13.0.3',
    });

    expect(commands[0].command).toContain(
      'http://localhost:3000/repository/nuget%20repo%231/index.json',
    );
    expect(commands[1].command).toContain(
      'http://localhost:3000/repository/nuget%20repo%231/index.json',
    );
    expect(commands[2].command).toContain(
      'http://localhost:3000/repository/nuget%20repo%231/index.json',
    );
    expect(commands[3].command).toContain(
      'value="http://localhost:3000/repository/nuget%20repo%231/index.json"',
    );
  });

  it('should escape repository name in generated NuGet.config', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'nuget "repo" & beta',
      type: 'hosted',
      manager: 'nuget',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'Newtonsoft.Json',
      version: '13.0.3',
    });

    expect(commands[3].command).toContain(
      'key="nuget &quot;repo&quot; &amp; beta"',
    );
    expect(commands[3].command).toContain(
      'value="http://localhost:3000/repository/nuget%20%22repo%22%20%26%20beta/index.json"',
    );
  });
});
