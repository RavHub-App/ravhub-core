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

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import type { Repository } from '../utils/types';

export type RegistryOptions = {
  port?: number;
  reposById?: Map<string, Repository>;
};

export type RegistryPluginContext = {
  plugin: any;
};

export type RegistryRequest = IncomingMessage & {
  method?: string;
  url?: string;
};

export type RegistryResponse = ServerResponse<IncomingMessage>;

export type RegistryDebug = (label: string, ...args: unknown[]) => void;

export type RegistryRequestContext = {
  repo: Repository;
  opts?: RegistryOptions;
  plugin: any;
  req: RegistryRequest;
  res: RegistryResponse;
  parsed: UrlWithParsedQuery;
  pathname: string;
  debug: RegistryDebug;
  chosenVersion: 'v2';
};
