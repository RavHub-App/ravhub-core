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

import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser();

export function parseMetadata(xml: string) {
  return parser.parse(xml);
}

export function resolveSnapshotVersion(
  metadata: any,
  extension: string,
  classifier?: string,
): string | null {
  const versioning = metadata?.metadata?.versioning;
  if (!versioning) return null;

  // Strategy 1: Use snapshotVersions list (preferred)
  if (
    versioning.snapshotVersions &&
    versioning.snapshotVersions.snapshotVersion
  ) {
    const versions = Array.isArray(versioning.snapshotVersions.snapshotVersion)
      ? versioning.snapshotVersions.snapshotVersion
      : [versioning.snapshotVersions.snapshotVersion];

    const match = versions.find((v: any) => {
      // Check extension
      if (v.extension !== extension) return false;
      // Check classifier
      if (classifier) {
        return v.classifier === classifier;
      } else {
        return !v.classifier;
      }
    });

    if (match) {
      return match.value; // e.g. 1.0.0-20230101.123456-1
    }
  }

  // Strategy 2: Use timestamp + buildNumber (fallback)
  // This usually applies to the main artifact (jar/pom) without classifier
  if (
    !classifier &&
    versioning.snapshot &&
    versioning.snapshot.timestamp &&
    versioning.snapshot.buildNumber
  ) {
    const version = metadata.metadata.version; // 1.0.0-SNAPSHOT
    if (version) {
      const baseVersion = version.replace('-SNAPSHOT', '');
      return `${baseVersion}-${versioning.snapshot.timestamp}-${versioning.snapshot.buildNumber}`;
    }
  }

  return null;
}

export function parseFilename(
  filename: string,
  version: string,
  artifactId: string,
) {
  // filename: artifactId-version[-classifier].extension[.checksum]
  // version: 1.0.0-SNAPSHOT

  let checksumExt = '';
  if (filename.endsWith('.sha1')) {
    checksumExt = '.sha1';
    filename = filename.slice(0, -5);
  } else if (filename.endsWith('.md5')) {
    checksumExt = '.md5';
    filename = filename.slice(0, -4);
  } else if (filename.endsWith('.sha256')) {
    checksumExt = '.sha256';
    filename = filename.slice(0, -7);
  } else if (filename.endsWith('.asc')) {
    checksumExt = '.asc';
    filename = filename.slice(0, -4);
  }

  // Remove artifactId and version from start
  const prefix = `${artifactId}-${version}`;
  if (!filename.startsWith(prefix)) return null;

  const rest = filename.slice(prefix.length);
  // rest: .jar or -sources.jar

  const lastDot = rest.lastIndexOf('.');
  if (lastDot === -1) return null;

  const extension = rest.slice(lastDot + 1);
  const classifierPart = rest.slice(0, lastDot); // "" or "-sources"

  let classifier: string | undefined = undefined;
  if (classifierPart.startsWith('-')) {
    classifier = classifierPart.slice(1);
  }

  return { extension, classifier, checksumExt };
}

export function normalizeRepoPath(p: string) {
  return p.replace(/^\/+/, '').replace(/\/+$/, '');
}

export function parseMavenCoordsFromPath(repoPath: string): {
  packageName: string;
  version: string;
} | null {
  // repoPath: groupIdPath/artifactId/version/filename
  const p = normalizeRepoPath(repoPath);
  const parts = p.split('/').filter(Boolean);
  if (parts.length < 4) return null;
  const version = parts[parts.length - 2];
  const artifactId = parts[parts.length - 3];
  if (!version || !artifactId) return null;
  const groupParts = parts.slice(0, -3);
  if (groupParts.length === 0) return null;
  const groupId = groupParts.join('.');
  // Use // as separator to match frontend routing and storage paths
  return { packageName: `${groupId}/${artifactId}`, version };
}
