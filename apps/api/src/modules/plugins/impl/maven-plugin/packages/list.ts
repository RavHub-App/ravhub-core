import { PluginContext, Repository } from '../utils/types';
import { buildKey } from '../utils/key-utils';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    // name is groupId:artifactId OR groupId/artifactId
    let groupId: string;
    let artifactId: string;

    if (name.includes(':')) {
      [groupId, artifactId] = name.split(':');
    } else {
      const parts = name.split('/');
      artifactId = parts.pop()!;
      groupId = parts.join('/');
    }

    if (!groupId || !artifactId) return { ok: false, message: 'Invalid package name format' };

    const groupPath = groupId.replace(/\./g, '/');
    const artifactPath = `${groupPath}/${artifactId}`;
    const versions = new Set<string>();

    const tryLoad = async (repoIdOrName: string) => {
      // Try standard hosted path
      const prefix = buildKey('maven', repoIdOrName, artifactPath);
      // Try proxy cache path
      const proxyPrefix = buildKey('maven', repoIdOrName, 'proxy', artifactPath);

      const prefixes = [prefix, proxyPrefix];

      for (const pfx of prefixes) {
        try {
          const keys = await storage.list(pfx);
          for (const key of keys) {
            // key: maven/<repo>/group/artifact/version/file
            // OR: maven/<repo>/proxy/group/artifact/version/file
            // storage.list returns keys relative to storage root, e.g. maven/repo/group/artifact/version/file
            // pfx is maven/repo/group/artifact

            // Ensure we are looking at files UNDER this prefix
            if (!key.startsWith(pfx)) continue;

            // Remove prefix to get relative path: /version/file
            let suffix = key.slice(pfx.length);
            if (suffix.startsWith('/')) suffix = suffix.slice(1);

            const parts = suffix.split('/');
            if (parts.length > 0) {
              const version = parts[0];
              // Filter out metadata files at the artifact root level
              if (version && version !== 'maven-metadata.xml' && !version.endsWith('.xml') && !version.endsWith('.asc') && !version.endsWith('.sha1') && !version.endsWith('.md5')) {
                // Check if it looks like a version directory (should contain files)
                // But storage.list returns files, so if we see version/file, then version is a directory.
                if (parts.length > 1) {
                  versions.add(version);
                }
              }
            }
          }
        } catch (e) {
          console.error(`[MavenPlugin] listVersions error:`, e);
        }
      }
    };

    await tryLoad(repo.id);
    await tryLoad(repo.name);

    return { ok: true, versions: Array.from(versions) };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const name = String(pkg?.name || '');
    let groupId = 'com.example';
    let artifactId = 'artifact';

    if (name.includes(':')) {
      const parts = name.split(':');
      if (parts[0]) groupId = parts[0];
      if (parts[1]) artifactId = parts[1];
    } else {
      const parts = name.split('/');
      if (parts.length > 0) {
        artifactId = parts.pop()!;
        if (parts.length > 0) groupId = parts.join('.');
      }
    }

    const version = pkg?.version || '1.0.0';

    return [
      {
        label: 'Maven (pom.xml)',
        language: 'xml',
        command: `<dependency>
  <groupId>${groupId}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>${version}</version>
</dependency>`,
      },
      {
        label: 'Maven (settings.xml)',
        language: 'xml',
        command: `<mirrors>
  <mirror>
    <id>${repo.name}</id>
    <mirrorOf>*</mirrorOf>
    <url>http://localhost:3000/repository/${repo.id}/</url>
  </mirror>
</mirrors>`,
      },
      {
        label: 'Gradle (Groovy)',
        language: 'groovy',
        command: `implementation '${groupId}:${artifactId}:${version}'`,
      },
      {
        label: 'Gradle (Kotlin)',
        language: 'kotlin',
        command: `implementation("${groupId}:${artifactId}:${version}")`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
