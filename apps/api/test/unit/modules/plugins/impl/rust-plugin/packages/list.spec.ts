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

import { initPackages } from 'src/modules/plugins/impl/rust-plugin/packages/list';
import type {
  PluginContext,
  Repository,
} from 'src/modules/plugins/impl/rust-plugin/utils/types';

jest.mock('src/modules/plugins/impl/rust-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('RustPlugin Packages', () => {
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

  it('should collect versions from real hosted and proxy storage layouts', async () => {
    const keys = [
      'rust/r1/crates/serde/1.0.0/serde-1.0.0.crate',
      'rust/r1/proxy/serde/1.0.1/serde-1.0.1.crate',
    ];

    mockStorage.list.mockImplementation(async (prefix: string) =>
      keys.filter((key) => key.startsWith(prefix)),
    );

    const repo: Repository = {
      id: 'r1',
      name: 'rust-repo',
      type: 'proxy',
      manager: 'rust',
    };

    const result = await packageMethods.listVersions(repo, 'serde');

    expect(result.ok).toBe(true);
    expect(result.versions).toEqual(expect.arrayContaining(['1.0.0', '1.0.1']));
  });

  it('should generate install commands', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'rust-repo',
      type: 'hosted',
      manager: 'rust',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'serde',
      version: '1.0.0',
    });

    expect(commands).toHaveLength(3);
    expect(commands[0].command).toContain('serde = { version = "1.0.0"');
    expect(commands[1].command).toContain('cargo add serde@1.0.0');
    expect(commands[2].command).toContain('[registries."rust-repo"]');
  });

  it('should encode index URLs and quote registry names', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'rust repo#beta',
      type: 'hosted',
      manager: 'rust',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'serde',
      version: '1.0.0',
    });

    expect(commands[0].command).toContain('registry = "rust repo#beta"');
    expect(commands[1].command).toContain(
      'cargo add serde@1.0.0 --registry "rust repo#beta"',
    );
    expect(commands[2].command).toContain('[registries."rust repo#beta"]');
    expect(commands[2].command).toContain(
      'index = "sparse+http://localhost:3000/repository/rust%20repo%23beta/index"',
    );
  });

  it('should escape registry names in Cargo.toml snippets', async () => {
    const repo: Repository = {
      id: 'r1',
      name: 'rust "beta" repo',
      type: 'hosted',
      manager: 'rust',
    };

    const commands = await packageMethods.getInstallCommand(repo, {
      name: 'serde',
      version: '1.0.0',
    });

    expect(commands[0].command).toContain('registry = "rust \\"beta\\" repo"');
    expect(commands[1].command).toContain(
      'cargo add serde@1.0.0 --registry "rust \\"beta\\" repo"',
    );
    expect(commands[2].command).toContain(
      '[registries."rust \\"beta\\" repo"]',
    );
  });
});
