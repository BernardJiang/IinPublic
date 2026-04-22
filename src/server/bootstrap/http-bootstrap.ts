import express from 'express';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import Gun from 'gun';
import { logger } from '../logger';
import { requestLogger } from '../middleware/request-logger';

function buildAllowedOrigin(): string[] | RegExp {
  return process.env.NODE_ENV === 'production'
    ? ['https://iinpublic.com']
    : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
}

export function createSocketServer(server: HttpServer): SocketIOServer {
  return new SocketIOServer(server, {
    cors: {
      // In dev/e2e we may run multiple webpack dev servers on adjacent ports.
      origin: buildAllowedOrigin(),
      methods: ['GET', 'POST'],
    },
  });
}

export function configureHttpMiddleware(app: express.Application): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-eval'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          workerSrc: ["'self'", 'blob:'],
        },
      },
    }),
  );

  app.use(
    cors({
      // Parallel e2e workers use adjacent localhost ports.
      origin: buildAllowedOrigin(),
      credentials: true,
    }),
  );

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(requestLogger);
  app.use(express.static('public'));
  app.use(express.static('.'));
  app.use((Gun as any).serve);
}

export function attachGun(server: HttpServer): any {
  const e2eMemoryOnly =
    process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.E2E_GUN_MEMORY_ONLY === 'true';
  const gun = Gun({
    web: server,
    localStorage: false,
    radisk: !e2eMemoryOnly,
    ...(e2eMemoryOnly ? { peers: [], axe: false, multicast: false } : {}),
  });
  logger.info({ radisk: !e2eMemoryOnly }, '🔫 Gun.js attached to HTTP server');
  return gun;
}
