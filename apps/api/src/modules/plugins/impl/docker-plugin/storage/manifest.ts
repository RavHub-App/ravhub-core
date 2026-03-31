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

import { buildKey } from '../utils/key-utils';
import type { Repository } from '../utils/types';
import { routeGroupManifestPut } from './manifest-group';
import { writeManifest } from './manifest-write';

let storage: any = null;
let getRepo: any = null;
let getBlob: any = null;
let proxyFetch: any = null;
let indexArtifact: any = null;

export function initManifest(context: {
  storage: any;
  getRepo?: any;
  getBlob?: any;
  proxyFetch?: any;
  indexArtifact?: any;
}) {
  storage = context.storage;
  getRepo = context.getRepo;
  getBlob = context.getBlob;
  proxyFetch = context.proxyFetch;
  indexArtifact = context.indexArtifact;
}

export async function putManifest(
  repo: Repository,
  name: string,
  tag: string,
  manifest: any,
  userId?: string,
) {
  if ((repo?.type || '').toString().toLowerCase() === 'proxy') {
    return {
      ok: false,
      message: 'proxy repositories are read-only (pulls only from upstream)',
    };
  }

  if ((repo?.type || '').toString().toLowerCase() === 'hosted') {
    const allowRedeploy = repo.config?.docker?.allowRedeploy !== false;
    if (!allowRedeploy) {
      const key = buildKey('docker', repo.id, name, `manifests/${tag}`);
      const exists = await storage.exists(key);
      if (exists) {
        return {
          ok: false,
          message: `Redeployment of ${name}:${tag} is not allowed`,
        };
      }
    }
  }

  if ((repo?.type || '').toString().toLowerCase() === 'group') {
    return routeGroupManifestPut(
      repo,
      name,
      tag,
      manifest,
      userId,
      getRepo,
      putManifest,
    );
  }

  try {
    return await writeManifest(repo, name, tag, manifest, userId, {
      storage,
      getBlob,
      proxyFetch,
      indexArtifact,
    });
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

export async function deleteManifest(
  repo: Repository,
  name: string,
  digest: string,
) {
  try {
    const key = buildKey('docker', repo.id, name, `manifests/${digest}`);
    const exists = await storage.exists(key);
    if (!exists) return { ok: false, message: 'not found' };
    await storage.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}

export async function deletePackageVersion(
  repo: Repository,
  name: string,
  version: string,
) {
  try {
    const key = buildKey('docker', repo.id, name, `manifests/${version}`);
    const exists = await storage.exists(key);
    if (!exists) return { ok: false, message: 'version not found' };
    await storage.delete(key);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: String(err) };
  }
}
