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

import { PluginContext } from '../utils/types';
import { createRawDownloader } from './download';
import { createRawPutHandler, createRawUploader } from './write';

export function initStorage(context: PluginContext) {
  const upload = createRawUploader(context);
  const handlePut = createRawPutHandler(context);
  const download = createRawDownloader(context);

  return { upload, download, handlePut };
}
