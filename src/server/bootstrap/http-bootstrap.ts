import express from 'express';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import Gun from 'gun';
import { logger } from '../logger';
import { requestLogger } from '../middleware/request-logger';
import { resolveP2PRuntimeFlags } from '../../shared/p2p-runtime';

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
  const devGunFresh = process.env.DEV_GUN_FRESH === '1';
  const p2pFlags = resolveP2PRuntimeFlags(process.env);
  const ephemeralStarServer = p2pFlags.starServerPersistence === 'ephemeral';
  const isolatedGun = e2eMemoryOnly || devGunFresh || ephemeralStarServer;
  const gun = Gun({
    web: server,
    localStorage: false,
    radisk: !isolatedGun,
    ...(isolatedGun ? { peers: [], axe: false, multicast: false } : {}),
  });
  logger.info(
    {
      radisk: !isolatedGun,
      devGunFresh,
      starServerPersistence: p2pFlags.starServerPersistence,
      p2pNodeEnabled: p2pFlags.p2pNodeEnabled,
      p2pDirectChatEnabled: p2pFlags.p2pDirectChatEnabled,
    },
    '🔫 Gun.js attached to HTTP server',
  );
  if (devGunFresh) {
    configureDevFreshGunIsolation(gun);
  }
  return gun;
}

function countActiveUsersInChatroom(gun: any, chatroomId: string, observeMs = 700): Promise<number> {
  return new Promise((resolve) => {
    const active = new Set<string>();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try {
        off.off();
      } catch {
        /* Gun peer */
      }
      resolve(active.size);
    };
    const off = gun
      .get('chatrooms')
      .get(chatroomId)
      .get('users')
      .map()
      .on((memberData: any, userId: string) => {
        if (!userId || userId.startsWith('_')) return;
        if (memberData && memberData.isActive === true) active.add(userId);
        else active.delete(userId);
      });
    setTimeout(finish, observeMs);
  });
}

/**
 * dev:stage-zero: another localhost tab or Gun peer can push a stale graph seconds after boot.
 * Scrub the server graph when Global headcount looks polluted.
 */
function configureDevFreshGunIsolation(gun: any): void {
  const bootedAt = Date.now();
  let scrubTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleScrub = (reason: string) => {
    if (Date.now() - bootedAt < 15_000) return;
    if (scrubTimer) clearTimeout(scrubTimer);
    scrubTimer = setTimeout(() => {
      void countActiveUsersInChatroom(gun, 'global').then((globalN) => {
        if (globalN <= 15) return;
        logger.warn(
          { globalN, reason },
          'DEV_GUN_FRESH: scrubbing stale Gun graph — close other localhost:3001 tabs',
        );
        if (gun?._?.graph) gun._.graph = {};
      });
    }, 900);
  };

  gun.on('hi', () => scheduleScrub('peer-hi'));
}
