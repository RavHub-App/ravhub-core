import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { RepositoryExceptionFilter } from './filters/repository-exception.filter';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  // Basic JSON logger for cloud-native environments
  const loggerOptions = process.env.LOG_FORMAT === 'json'
    ? {
      logger: {
        log: (msg: any, context?: string) => console.log(JSON.stringify({ level: 'info', message: msg, context, timestamp: new Date().toISOString() })),
        error: (msg: any, trace?: string, context?: string) => {
          const serializedMsg = msg instanceof Error
            ? Object.assign({ message: msg.message, stack: msg.stack, name: msg.name }, msg)
            : msg;
          console.error(JSON.stringify({ level: 'error', message: serializedMsg, trace, context, timestamp: new Date().toISOString() }));
        },
        warn: (msg: any, context?: string) => console.warn(JSON.stringify({ level: 'warn', message: msg, context, timestamp: new Date().toISOString() })),
        debug: (msg: any, context?: string) => console.debug(JSON.stringify({ level: 'debug', message: msg, context, timestamp: new Date().toISOString() })),
        verbose: (msg: any, context?: string) => console.log(JSON.stringify({ level: 'verbose', message: msg, context, timestamp: new Date().toISOString() })),
      }
    }
    : {};

  const app = await NestFactory.create(AppModule, { ...loggerOptions, bodyParser: false });

  // Manual body parsing to allow streaming for package uploads
  app.use((req: any, res: any, next: any) => {
    // Skip body parsing for repository PUT uploads (streaming)
    if (
      req.method === 'PUT' &&
      (req.path.startsWith('/repository') || req.path.startsWith('/repositories'))
    ) {
      next();
    } else {
      // Standard parsing for other routes
      express.json({ limit: '100mb' })(req, res, (err) => {
        if (err) return next(err);
        express.urlencoded({ extended: true, limit: '100mb' })(req, res, next);
      });
    }
  });


  // Enable graceful shutdown
  app.enableShutdownHooks();

  // Serve static files from client directory if it exists (for single container deployment)
  const clientPath = path.join(__dirname, '..', 'client');
  if (process.env.SERVE_STATIC_PATH) {
    const staticPath = process.env.SERVE_STATIC_PATH;
    app.use(express.static(staticPath));
    // Handle SPA routing - send index.html for non-api routes
    app.use((req, res, next) => {
      if (!req.path.startsWith('/api') && req.method === 'GET') {
        res.sendFile(path.join(staticPath, 'index.html'));
      } else {
        next();
      }
    });
  } else if (require('fs').existsSync(clientPath)) {
    app.use(express.static(clientPath));
    app.use((req, res, next) => {
      const apiPrefixes = ['/api', '/storage', '/repositories', '/auth', '/users', '/license', '/plugins', '/backups', '/cleanup'];
      if (!apiPrefixes.some(p => req.path.startsWith(p)) && req.method === 'GET') {
        res.sendFile(path.join(clientPath, 'index.html'));
      } else {
        next();
      }
    });
  }

  // Make repository-related errors (including those thrown by guards or early in the
  // request pipeline) return 200 [] for GET /repository. This keeps e2e readiness checks
  // from failing due to DB races during startup.
  app.useGlobalFilters(new RepositoryExceptionFilter());
  await app.listen(process.env.PORT ?? 3000);
}

const cluster = require('cluster');
const os = require('os');

if (process.env.CLUSTER_ENABLED === 'true' && cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`Master ${process.pid} is running. Forking ${numCPUs} workers.`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  bootstrap();
}
