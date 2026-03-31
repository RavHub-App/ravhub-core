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
import { PluginContext, Repository } from '../utils/types';
import { buildHostedPackagesJson } from './packages-json';
import { createComposerProxyDownloader } from './proxy-download';
import { createComposerPutHandler, createComposerUploader } from './write';
import { createComposerDownloader } from './download';

export function initStorage(context: PluginContext) {
  const proxyDownload = createComposerProxyDownloader(context);
  const upload = createComposerUploader(context);
  const handlePut = createComposerPutHandler(context, upload);
  const download = createComposerDownloader(context, proxyDownload);

  return { upload, download, proxyDownload, handlePut };
}
