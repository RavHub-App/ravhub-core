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

import {
  parseMetadata,
  resolveSnapshotVersion,
  parseFilename,
  normalizeRepoPath,
  parseMavenCoordsFromPath,
} from 'src/modules/plugins/impl/maven-plugin/utils/maven';

describe('MavenPlugin Utils - Maven Helpers', () => {
  describe('parseMetadata', () => {
    it('should parse valid XML metadata', () => {
      const xml = `
                <metadata>
                    <groupId>com.example</groupId>
                    <artifactId>lib</artifactId>
                    <versioning>
                        <latest>1.0.0</latest>
                    </versioning>
                </metadata>
            `;
      const result = parseMetadata(xml);
      expect(result.metadata.groupId).toBe('com.example');
      expect(result.metadata.artifactId).toBe('lib');
      expect(result.metadata.versioning.latest).toBe('1.0.0');
    });
  });

  describe('resolveSnapshotVersion', () => {
    const metadata = {
      metadata: {
        version: '1.0.0-SNAPSHOT',
        versioning: {
          snapshot: {
            timestamp: '20230101.120000',
            buildNumber: '1',
          },
          snapshotVersions: {
            snapshotVersion: [
              {
                extension: 'jar',
                value: '1.0.0-20230101.120000-1',
                updated: '20230101120000',
              },
              {
                extension: 'jar',
                classifier: 'sources',
                value: '1.0.0-20230101.120000-1',
                updated: '20230101120000',
              },
            ],
          },
        },
      },
    };

    it('should resolve using snapshotVersions list', () => {
      const result = resolveSnapshotVersion(metadata, 'jar');
      expect(result).toBe('1.0.0-20230101.120000-1');
    });

    it('should resolve classifier using snapshotVersions', () => {
      const result = resolveSnapshotVersion(metadata, 'jar', 'sources');
      expect(result).toBe('1.0.0-20230101.120000-1');
    });

    it('should fallback to timestamp if extension not found in list but snapshot info exists', () => {
      const result = resolveSnapshotVersion(metadata, 'war');
      expect(result).toBe('1.0.0-20230101.120000-1');
    });

    it('should fallback to timestamp + buildNumber if classifier is not requested', () => {
      const metadataFallback = {
        metadata: {
          version: '1.0.0-SNAPSHOT',
          versioning: {
            snapshot: {
              timestamp: '20230101.120000',
              buildNumber: '5',
            },
          },
        },
      };
      const result = resolveSnapshotVersion(metadataFallback, 'jar');
      expect(result).toBe('1.0.0-20230101.120000-5');
    });

    it('should return null if metadata invalid', () => {
      expect(resolveSnapshotVersion({}, 'jar')).toBeNull();
    });
  });

  describe('parseFilename', () => {
    const version = '1.0.0-SNAPSHOT';
    const artifactId = 'my-lib';

    it('should parse standard jar', () => {
      const result = parseFilename(
        'my-lib-1.0.0-SNAPSHOT.jar',
        version,
        artifactId,
      );
      expect(result).toEqual({
        extension: 'jar',
        classifier: undefined,
        checksumExt: '',
      });
    });

    it('should parse jar with classifier', () => {
      const result = parseFilename(
        'my-lib-1.0.0-SNAPSHOT-sources.jar',
        version,
        artifactId,
      );
      expect(result).toEqual({
        extension: 'jar',
        classifier: 'sources',
        checksumExt: '',
      });
    });

    it('should parse checksum file', () => {
      const result = parseFilename(
        'my-lib-1.0.0-SNAPSHOT.jar.sha1',
        version,
        artifactId,
      );
      expect(result).toEqual({
        extension: 'jar',
        classifier: undefined,
        checksumExt: '.sha1',
      });
    });

    it('should return null if prefix does not match', () => {
      const result = parseFilename('other-lib-1.0.0.jar', version, artifactId);
      expect(result).toBeNull();
    });

    it('should return null for malformed filename', () => {
      const result = parseFilename(
        'my-lib-1.0.0-SNAPSHOT',
        version,
        artifactId,
      );
      expect(result).toBeNull();
    });
  });

  describe('normalizeRepoPath', () => {
    it('should trim slashes', () => {
      expect(normalizeRepoPath('/path/to/file/')).toBe('path/to/file');
    });
  });

  describe('parseMavenCoordsFromPath', () => {
    it('should parse valid coords', () => {
      const path = 'com/example/lib/1.0.0/lib-1.0.0.jar';
      const result = parseMavenCoordsFromPath(path);
      expect(result).toEqual({
        packageName: 'com.example/lib',
        version: '1.0.0',
      });
    });

    it('should handle deeper groups', () => {
      const path = 'org/apache/commons/io/2.11.0/io-2.11.0.jar';
      const result = parseMavenCoordsFromPath(path);
      expect(result).toEqual({
        packageName: 'org.apache.commons/io',
        version: '2.11.0',
      });
    });

    it('should return null for invalid path', () => {
      expect(parseMavenCoordsFromPath('invalid/path')).toBeNull();
    });

    it('should return null if parts missing', () => {
      expect(parseMavenCoordsFromPath('com/lib/1.0.0')).toBeNull();
    });
  });
});
