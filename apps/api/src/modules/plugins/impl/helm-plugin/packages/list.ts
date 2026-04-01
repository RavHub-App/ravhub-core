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

import {
  PluginContext,
  Repository,
} from '../../../../../plugins-core/plugin.interface';
import { buildKey } from '../utils/key-utils';
import * as yaml from 'js-yaml';

type HelmIndexEntry = {
  version?: string;
  created?: string;
  description?: string;
  urls?: string[];
};

type HelmIndex = {
  entries?: Record<string, HelmIndexEntry[]>;
};

export function initPackages(context: PluginContext) {
  const { storage, getRepo } = context;

  const toHelmRepoAlias = (repoName: string) => {
    const normalized = repoName
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '');

    return normalized || 'repo';
  };

  const toHelmReleaseName = (chartName: string) => {
    const normalized = chartName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 53);

    return normalized || 'chart';
  };

  const getIndexKeys = (repo: Repository) => {
    const keys = [
      buildKey('helm', repo.id, 'index.yaml'),
      buildKey('helm', repo.name, 'index.yaml'),
    ];

    if (repo.type === 'proxy') {
      keys.push(
        buildKey('helm', repo.id, 'proxy', 'file', 'index.yaml'),
        buildKey('helm', repo.name, 'proxy', 'file', 'index.yaml'),
      );
    }

    return keys.filter((value, index, array) => !!value && array.indexOf(value) === index);
  };

  const mergeChartEntries = (
    charts: Map<string, Map<string, HelmIndexEntry>>,
    entries: Map<string, Map<string, HelmIndexEntry>>,
  ) => {
    for (const [chartName, versions] of entries.entries()) {
      if (!charts.has(chartName)) {
        charts.set(chartName, new Map<string, HelmIndexEntry>());
      }

      const targetVersions = charts.get(chartName)!;
      for (const [version, entry] of versions.entries()) {
        targetVersions.set(version, entry);
      }
    }
  };

  const getChartEntries = async (
    repo: Repository,
    visited = new Set<string>(),
  ) => {
    const charts = new Map<string, Map<string, HelmIndexEntry>>();

    const visitKey = repo.id || repo.name;
    if (visitKey) {
      if (visited.has(visitKey)) {
        return charts;
      }
      visited.add(visitKey);
    }

    if (repo.type === 'group') {
      const memberIds: string[] = Array.isArray(repo.config?.members)
        ? repo.config.members
        : [];

      for (const memberId of memberIds) {
        const memberRepo = await getRepo?.(memberId);
        if (!memberRepo) {
          continue;
        }

        const memberCharts = await getChartEntries(memberRepo, visited);
        mergeChartEntries(charts, memberCharts);
      }

      return charts;
    }

    for (const indexKey of getIndexKeys(repo)) {
      try {
        const content = await storage.get(indexKey);
        if (!content) {
          continue;
        }

        const index = yaml.load(content.toString()) as HelmIndex;
        if (!index?.entries) {
          continue;
        }

        for (const [chartName, entries] of Object.entries(index.entries)) {
          if (!Array.isArray(entries)) {
            continue;
          }

          if (!charts.has(chartName)) {
            charts.set(chartName, new Map<string, HelmIndexEntry>());
          }

          const versions = charts.get(chartName)!;
          for (const entry of entries) {
            const version = entry?.version;
            if (!version) {
              continue;
            }
            versions.set(version, entry);
          }
        }
      } catch {
        continue;
      }
    }

    return charts;
  };

  const selectPreferredEntry = (entries: HelmIndexEntry[]) => {
    return [...entries].sort((left, right) => {
      const leftCreated = left.created ? Date.parse(left.created) : NaN;
      const rightCreated = right.created ? Date.parse(right.created) : NaN;

      if (!Number.isNaN(leftCreated) && !Number.isNaN(rightCreated)) {
        return rightCreated - leftCreated;
      }

      return String(right.version || '').localeCompare(
        String(left.version || ''),
        undefined,
        { numeric: true, sensitivity: 'base' },
      );
    })[0];
  };

  const listPackages = async (repo: Repository) => {
    const charts = await getChartEntries(repo);
    const packages = Array.from(charts.entries())
      .map(([name, versions]) => {
        const preferred = selectPreferredEntry(Array.from(versions.values()));
        return {
          name,
          latestVersion: preferred?.version || 'unknown',
          updatedAt: preferred?.created || new Date().toISOString(),
        };
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return { ok: true, packages };
  };

  const listVersions = async (repo: Repository, name: string) => {
    const charts = await getChartEntries(repo);
    const versions = charts.get(name);

    return { ok: true, versions: Array.from(versions?.keys() || []) };
  };

  const getPackage = async (repo: Repository, name: string) => {
    const charts = await getChartEntries(repo);
    const versions = charts.get(name);

    if (!versions) {
      return { ok: true, name, artifacts: [] };
    }

    const artifacts = Array.from(versions.values())
      .map((entry) => ({
        version: entry.version || 'unknown',
        createdAt: entry.created || null,
        metadata: {
          description: entry.description,
          urls: entry.urls || [],
        },
      }))
      .sort((left, right) => {
        const leftCreated = left.createdAt ? Date.parse(left.createdAt) : NaN;
        const rightCreated = right.createdAt ? Date.parse(right.createdAt) : NaN;

        if (!Number.isNaN(leftCreated) && !Number.isNaN(rightCreated)) {
          return rightCreated - leftCreated;
        }

        return String(right.version).localeCompare(String(left.version), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      });

    return { ok: true, name, artifacts };
  };

  const getInstallCommand = async (repo: Repository, pkg: any) => {
    const host = process.env.API_HOST || 'localhost:3000';
    const proto = process.env.API_PROTOCOL || 'http';
    const repoUrl = `${proto}://${host}/repository/${encodeURIComponent(repo.name)}`;
    const repoAlias = toHelmRepoAlias(repo.name);
    const name = pkg?.name || 'chart';
    const version = pkg?.version || '0.1.0';
    const releaseName = toHelmReleaseName(name);

    return [
      {
        label: 'helm install',
        language: 'bash',
        command: `helm repo add ${repoAlias} ${repoUrl}
helm repo update
helm install ${releaseName} ${repoAlias}/${name} --version ${version}`,
      },
      {
        label: 'helm dependency',
        language: 'yaml',
        command: `dependencies:
- name: ${name}
  version: ${version}
  repository: ${repoUrl}`,
      },
    ];
  };

  return { listPackages, listVersions, getPackage, getInstallCommand };
}
