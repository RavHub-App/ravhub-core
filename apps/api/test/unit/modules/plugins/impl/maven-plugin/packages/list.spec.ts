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

import { initPackages } from 'src/modules/plugins/impl/maven-plugin/packages/list';
import { Repository } from 'src/modules/plugins/impl/maven-plugin/utils/types';

jest.mock('src/modules/plugins/impl/maven-plugin/utils/key-utils', () => ({
  buildKey: jest.fn((...args) => args.join('/')),
}));

describe('MavenPlugin Packages', () => {
  let mockStorage: any;
  let packagesMethods: ReturnType<typeof initPackages>;

  beforeEach(() => {
    mockStorage = {
      list: jest.fn().mockResolvedValue([]),
    };
    packagesMethods = initPackages({ storage: mockStorage } as any);
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    (console.error as jest.Mock).mockRestore();
  });

  describe('listVersions', () => {
    const repo: Repository = { id: 'r1', name: 'maven-repo' } as any;

    it('should list versions for groupId:artifactId', async () => {
      mockStorage.list.mockResolvedValue([
        'maven/r1/com/example/lib/1.0.0/lib-1.0.0.jar',
        'maven/r1/com/example/lib/1.1.0/lib-1.1.0.jar',
        'maven/r1/com/example/lib/maven-metadata.xml',
      ]);

      const result = await packagesMethods.listVersions(
        repo,
        'com.example:lib',
      );

      expect(result.ok).toBe(true);
      expect(result.versions).toHaveLength(2);
      expect(result.versions).toContain('1.0.0');
      expect(result.versions).toContain('1.1.0');
    });

    it('should list versions for path format', async () => {
      mockStorage.list.mockResolvedValue([
        'maven/r1/com/example/lib/1.0.0/lib-1.0.0.jar',
      ]);

      const result = await packagesMethods.listVersions(
        repo,
        'com/example/lib',
      );

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('1.0.0');
    });

    it('should handle proxy cache paths', async () => {
      mockStorage.list.mockResolvedValue([
        'maven/r1/proxy/com/example/lib/2.0.0/lib-2.0.0.jar',
      ]);

      const result = await packagesMethods.listVersions(
        repo,
        'com.example:lib',
      );

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('2.0.0');
    });

    it('should check both repo ID and Name', async () => {
      mockStorage.list
        .mockResolvedValueOnce([]) // ID hosted
        .mockResolvedValueOnce([]) // ID proxy
        .mockResolvedValueOnce([
          'maven/maven-repo/com/example/lib/1.0.0/file.jar',
        ]) // Name hosted
        .mockResolvedValueOnce([]); // Name proxy

      const result = await packagesMethods.listVersions(
        repo,
        'com.example:lib',
      );

      expect(result.ok).toBe(true);
      expect(result.versions).toContain('1.0.0');
    });

    it('should filter out metadata files', async () => {
      mockStorage.list.mockResolvedValue([
        'maven/r1/com/example/lib/maven-metadata.xml.sha1',
        'maven/r1/com/example/lib/1.0.0/file.jar',
      ]);

      const result = await packagesMethods.listVersions(
        repo,
        'com.example:lib',
      );

      expect(result.versions).not.toContain('maven-metadata.xml.sha1');
      expect(result.versions).toContain('1.0.0');
    });

    it('should gracefully handle storage errors', async () => {
      mockStorage.list.mockRejectedValue(new Error('Storage access failed'));

      // Should catch and continue (e.g., trying other paths) or return empty
      const result = await packagesMethods.listVersions(
        repo,
        'com.example:lib',
      );

      expect(result.ok).toBe(true);
      expect(result.versions).toEqual([]);
    });

    it('should return error for invalid package name format', async () => {
      const result = await packagesMethods.listVersions(repo, '');
      expect(result.ok).toBe(false);
      expect(result.message).toBe('Invalid package name format');
    });
  });

  describe('getInstallCommand', () => {
    const repo: Repository = { id: 'r1', name: 'maven-repo' } as any;

    it('should generate commands for groupId:artifactId', async () => {
      const pkg = { name: 'com.example:lib', version: '1.0.0' };
      const commands = await packagesMethods.getInstallCommand(repo, pkg);

      expect(
        commands.find((c) => c.label === 'Maven (pom.xml)')?.command,
      ).toContain('<groupId>com.example</groupId>');
      expect(
        commands.find((c) => c.label === 'Maven (pom.xml)')?.command,
      ).toContain('<artifactId>lib</artifactId>');
    });

    it('should generate commands for path format', async () => {
      const pkg = { name: 'com/example/lib', version: '1.0.0' };
      const commands = await packagesMethods.getInstallCommand(repo, pkg);

      expect(
        commands.find((c) => c.label === 'Gradle (Kotlin)')?.command,
      ).toContain('"com.example:lib:1.0.0"');
    });

    it('should include correct repo URL in settings.xml', async () => {
      const pkg = { name: 'lib', version: '1.0.0' };
      const commands = await packagesMethods.getInstallCommand(repo, pkg);

      expect(
        commands.find((c) => c.label === 'Maven (settings.xml)')?.command,
      ).toContain('/repository/r1/');
    });
  });
});
