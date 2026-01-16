import { PluginContext, Repository } from '../utils/types';
import { buildKey } from '../utils/key-utils';

export function initPackages(context: PluginContext) {
  const { storage } = context;

  const listVersions = async (repo: Repository, name: string) => {
    const versions = new Set<string>();

    // Check ID-based keys
    const prefixId = buildKey('pypi', repo.id, name);
    try {
      const keys = await storage.list(prefixId);
      for (const key of keys) {
        // key format: pypi/<repo.id>/<name>/<version>
        const parts = key.split('/');
        if (parts.length >= 4) {
          versions.add(parts[3]);
        }
      }
    } catch (e) { /* ignore */ }

    // Check Name-based keys (fallback)
    const prefixName = buildKey('pypi', repo.name, name);
    try {
      const keys = await storage.list(prefixName);
      for (const key of keys) {
        const parts = key.split('/');
        if (parts.length >= 4) {
          versions.add(parts[3]);
        }
      }
    } catch (e) { /* ignore */ }

    return { ok: true, versions: Array.from(versions) };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const indexUrl = `${proto}://${host}/repository/${repo.name}/simple`;
    const name = pkg?.name || 'package';
    const version = pkg?.version || '0.0.1';

    return [
      {
        label: 'pip',
        language: 'bash',
        command: `pip install ${name}==${version} --index-url ${indexUrl}`,
      },
      {
        label: 'poetry',
        language: 'bash',
        command: `poetry add ${name}==${version} --source ${repo.name}`,
      },
      {
        label: 'pip.conf',
        language: 'ini',
        command: `[global]
index-url = ${indexUrl}
trusted-host = ${host.split(':')[0]}`,
      },
    ];
  };

  return { listVersions, getInstallCommand };
}
