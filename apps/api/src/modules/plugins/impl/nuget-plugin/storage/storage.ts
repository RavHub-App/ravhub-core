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

import type { PluginContext, Repository } from '../utils/types';
import { createNugetDownloader } from './download';
import { handleNugetGroupPut, handleNugetGroupUpload } from './group-write';
import {
  allowNugetRedeploy,
  getNugetUploadBuffer,
  getRequestBodyBuffer,
  parseNugetPath,
  type NugetConfig,
  type NugetPackage,
  type NugetStorageRequest,
  type NugetUploadResult,
  type ProxyFetchResponse,
} from './storage-helpers';
import {
  buildNugetPackageKeys,
  ensurePutRedeployAllowed,
  ensureUploadRedeployAllowed,
  saveNugetPut,
  saveNugetUpload,
} from './storage-write-support';

type NugetDownloadResult = {
  ok: boolean;
  data?: Buffer;
  contentType?: string;
  message?: string;
};

type ProxyFetch = (
  repo: Repository,
  path: string,
) => Promise<ProxyFetchResponse>;

type NugetUploadHandler = (
  repo: Repository,
  pkg: NugetPackage,
) => Promise<NugetUploadResult>;

type NugetDownloadHandler = (
  repo: Repository,
  name: string,
  version?: string,
) => Promise<NugetDownloadResult>;

type NugetPutHandler = (
  repo: Repository,
  path: string,
  req: NugetStorageRequest,
) => Promise<NugetUploadResult>;

type NugetStorageHandlers = {
  upload: NugetUploadHandler;
  download: NugetDownloadHandler;
  handlePut: NugetPutHandler;
};

type NugetGroupUploadHandler = (
  context: PluginContext,
  repo: Repository,
  pkg: NugetPackage,
  upload: NugetUploadHandler,
) => Promise<NugetUploadResult>;

type NugetGroupPutHandler = (
  context: PluginContext,
  repo: Repository,
  path: string,
  req: NugetStorageRequest,
  handlePut: NugetPutHandler,
) => Promise<NugetUploadResult>;

type NugetPathParser = (path: string) => {
  pkgName: string;
  pkgVersion: string;
};

export function initStorage(
  context: PluginContext,
  proxyFetch?: ProxyFetch,
): NugetStorageHandlers {
  const { storage } = context;
  const createDownloader = createNugetDownloader as unknown as (
    context: PluginContext,
    proxyFetch?: ProxyFetch,
  ) => { download: NugetDownloadHandler };
  const groupUpload = handleNugetGroupUpload as NugetGroupUploadHandler;
  const groupPut = handleNugetGroupPut as NugetGroupPutHandler;
  const parsePath = parseNugetPath as NugetPathParser;
  const getUploadBuffer = getNugetUploadBuffer as (
    pkg: NugetPackage | Buffer,
  ) => Buffer;
  const getBodyBuffer = getRequestBodyBuffer as (
    req: NugetStorageRequest,
  ) => Promise<Buffer>;
  const canRedeploy = allowNugetRedeploy as (config: NugetConfig) => boolean;
  const downloader = createDownloader(context, proxyFetch);
  const download = downloader.download;

  const upload: NugetUploadHandler = async (
    repo: Repository,
    pkg: NugetPackage,
  ) => {
    if (repo.type === 'group') {
      return groupUpload(context, repo, pkg, upload);
    }

    const config = (repo.config ?? {}) as NugetConfig;
    const name = pkg.name ?? 'package';
    const version = pkg.version ?? '1.0.0';
    const { keyId, keyName } = buildNugetPackageKeys(repo, name, version);
    const buf = getUploadBuffer(pkg);
    const allowRedeploy = canRedeploy(config);
    if (!allowRedeploy) {
      const redeployError = await ensureUploadRedeployAllowed(
        storage,
        allowRedeploy,
        keyId,
        keyName,
        name,
        version,
      );
      if (redeployError) {
        return redeployError;
      }
    }

    try {
      return await saveNugetUpload(context, repo, name, version, keyId, buf);
    } catch (err: any) {
      console.error(
        `[NuGetPlugin] Failed to upload package: ${name}:${version} to repo: ${repo.id}. Error: ${String(err)}`,
      );
      return { ok: false, message: String(err) };
    }
  };

  const handlePut: NugetPutHandler = async (
    repo: Repository,
    path: string,
    req: NugetStorageRequest,
  ) => {
    if (repo.type === 'group') {
      return groupPut(context, repo, path, req, handlePut);
    }

    const { pkgName, pkgVersion } = parsePath(path);
    const config = (repo.config ?? {}) as NugetConfig;

    console.log(
      `[NuGetPlugin] handlePut: Attempting to put package ${pkgName}:${pkgVersion} to repo: ${repo.id} via path: ${path}`,
    );

    const { keyId } = buildNugetPackageKeys(repo, pkgName, pkgVersion);

    const allowRedeploy = canRedeploy(config);
    if (!allowRedeploy) {
      const redeployError = await ensurePutRedeployAllowed(
        storage,
        allowRedeploy,
        keyId,
        pkgName,
        pkgVersion,
      );
      if (redeployError) {
        return redeployError;
      }
    }

    try {
      return await saveNugetPut(
        context,
        repo,
        pkgName,
        pkgVersion,
        keyId,
        req,
        getBodyBuffer,
      );
    } catch (err: any) {
      return { ok: false, message: String(err) };
    }
  };

  return { upload, download, handlePut };
}
