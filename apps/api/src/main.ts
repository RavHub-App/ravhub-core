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

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const loggerOptions =
    process.env.LOG_FORMAT === 'json'
      ? {
          logger: {
            log: (msg: any, context?: string) =>
              console.log(
                JSON.stringify({
                  level: 'info',
                  message: msg,
                  context,
                  timestamp: new Date().toISOString(),
                }),
              ),
            error: (msg: any, trace?: string, context?: string) => {
              const serializedMsg =
                msg instanceof Error
                  ? Object.assign(
                      {
                        message: msg.message,
                        stack: msg.stack,
                        name: msg.name,
                      },
                      msg,
                    )
                  : msg;
              console.error(
                JSON.stringify({
                  level: 'error',
                  message: serializedMsg,
                  trace,
                  context,
                  timestamp: new Date().toISOString(),
                }),
              );
            },
            warn: (msg: any, context?: string) =>
              console.warn(
                JSON.stringify({
                  level: 'warn',
                  message: msg,
                  context,
                  timestamp: new Date().toISOString(),
                }),
              ),
            debug: (msg: any, context?: string) =>
              console.debug(
                JSON.stringify({
                  level: 'debug',
                  message: msg,
                  context,
                  timestamp: new Date().toISOString(),
                }),
              ),
            verbose: (msg: any, context?: string) =>
              console.log(
                JSON.stringify({
                  level: 'verbose',
                  message: msg,
                  context,
                  timestamp: new Date().toISOString(),
                }),
              ),
          },
        }
      : {};

  const app = await NestFactory.create(AppModule, {
    ...loggerOptions,
    bodyParser: false,
  });

  app.use((req: any, res: any, next: any) => {
    if (
      req.method === 'PUT' &&
      (req.path.startsWith('/repository') ||
        req.path.startsWith('/repositories'))
    ) {
      next();
    } else {
      express.json({ limit: '100mb' })(req, res, (err) => {
        if (err) return next(err);
        express.urlencoded({ extended: true, limit: '100mb' })(req, res, next);
      });
    }
  });

  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
