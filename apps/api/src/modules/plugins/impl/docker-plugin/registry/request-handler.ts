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

import type { IncomingHttpHeaders } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import { parse } from 'node:url';
import { handleBlobRoute } from './blob-handlers';
import { handleManifestRoute, handleTagsListRoute } from './manifest-handlers';
import {
  handleBlobUploadAppend,
  handleBlobUploadFinalize,
  handleSingleStepUploadInitiation,
  handleUploadInitiation,
} from './upload-handlers';
import {
  handleRegistryPingRoute,
  handleTokenProxyRoute,
} from './token-handler';
import type {
  RegistryDebug,
  RegistryOptions,
  RegistryPluginContext,
  RegistryRequestContext,
} from './types';
import type { Repository } from '../utils/types';

type RegistryRequestHandlerRequest = {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
};

type RegistryRequestHandlerResponse = {
  statusCode: number;
  end: (chunk?: string | Buffer) => void;
};

type RegistryRequestHandlerContext = {
  plugin: unknown;
};

type RegistryRequestState = {
  req: RegistryRequestHandlerRequest;
  res: RegistryRequestHandlerResponse;
  parsed: UrlWithParsedQuery;
  pathname: string;
};

function createDebug(): RegistryDebug {
  return (label: string, ...args: unknown[]) => {
    if (process.env.DEBUG_REGISTRY === 'true') {
      console.debug(label, ...args);
    }
  };
}

export function createRegistryRequestHandler(
  repo: Repository,
  opts: RegistryOptions | undefined,
  context: RegistryPluginContext,
) {
  const plugin = (context as RegistryRequestHandlerContext).plugin;

  return async (req: unknown, res: unknown) => {
    try {
      const requestUrl = (req as RegistryRequestHandlerRequest).url ?? '';
      const parsed = parse(requestUrl, true);
      const requestState: RegistryRequestState = {
        req: req as RegistryRequestHandlerRequest,
        res: res as RegistryRequestHandlerResponse,
        parsed,
        pathname: parsed.pathname || '',
      };
      const request = requestState.req;
      const response = requestState.res;
      const debug = createDebug();
      debug('[REGISTRY]', request.method, request.url, {
        hasAuth: !!request.headers.authorization,
        authType:
          typeof request.headers.authorization === 'string'
            ? request.headers.authorization.split(' ')[0]
            : undefined,
      });
      const requestContext = {
        repo,
        opts,
        plugin,
        req: requestState.req,
        res: requestState.res,
        parsed: requestState.parsed,
        pathname: requestState.pathname,
        debug,
        chosenVersion: 'v2',
      } as RegistryRequestContext;

      if (handleTokenProxyRoute(requestContext)) return;
      if (handleRegistryPingRoute(requestContext)) return;
      if (await handleTagsListRoute(requestContext)) return;
      if (await handleUploadInitiation(requestContext)) return;
      if (await handleSingleStepUploadInitiation(requestContext)) return;
      if (await handleBlobUploadAppend(requestContext)) return;
      if (await handleBlobUploadFinalize(requestContext)) return;
      if (await handleManifestRoute(requestContext)) return;
      if (await handleBlobRoute(requestContext)) return;

      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, message: 'not found' }));
    } catch (error: any) {
      const response = res as RegistryRequestHandlerResponse;
      response.statusCode = 500;
      response.end(JSON.stringify({ ok: false, message: String(error) }));
    }
  };
}
