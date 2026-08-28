import express from 'express';
import fs from 'fs';
import path from 'path';
import { registerDownloadRoutes } from '../routes/downloads-routes';
import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import Gun from 'gun';
import { logger } from '../logger';
import { requestLogger } from '../middleware/request-logger';
import { isLoopbackEmbeddedNode, isPlaintextHttpAllowed } from '../tls-mode';
import { resolveP2PRuntimeFlags } from '../../shared/p2p-runtime';
import { resolveEmbeddedNodeConfig } from '../../shared/embedded-node-config';

export function buildAllowedOrigin(): Array<string | RegExp> | RegExp {
  if (isLoopbackEmbeddedNode(process.env)) {
    return /^http:\/\/(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])(:\d+)?$/;
  }
  if (process.env.NODE_ENV !== 'production') {
    return isPlaintextHttpAllowed(process.env)
      ? /^http:\/\/[^/]+(:\d+)?$/
      : /^https:\/\/[^/]+(:\d+)?$/;
  }

  const configuredOrigins = (process.env.IINPUBLIC_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configuredOrigins.length > 0) return configuredOrigins;

  return [
    /^https:\/\/(?:www\.)?iinpublic\.com$/,
    // Keep the first Render deployment testable before the custom-domain cutover.
    'https://iinpublic-network.onrender.com',
  ];
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
  const hostedHttps =
    process.env.NODE_ENV === 'production' &&
    process.env.IINPUBLIC_TLS_TERMINATED_BY_PROXY === '1';
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
          // Helmet's CSP defaults (merged in unless overridden per-key) include
          // upgrade-insecure-requests, which silently forces every subresource fetch —
          // bundle.js included — onto https:// even when the page itself loaded over
          // plain http. This relay runs plain HTTP in most dev/LAN-test sessions
          // (TLS_DISABLE), so that directive breaks the app load entirely (WebKit/Safari
          // enforces it strictly per-resource: the page shell loads, bundle.js's upgraded
          // https request then fails TLS against an http-only server, and the app hangs
          // at "Connecting..." forever with no visible network error). null opts the
          // directive out of the merged default set.
          upgradeInsecureRequests: hostedHttps ? [] : null,
        },
      },
      // This relay toggles between plain HTTP and self-signed HTTPS across dev/LAN-test
      // sessions (TLS_DISABLE). Helmet's default Strict-Transport-Security header poisons
      // any browser that ever saw it over a genuine HTTPS response into force-upgrading
      // every future request to this host to HTTPS for months (default max-age 180 days)
      // — including subresource fetches — which then silently fails once the relay drops
      // back to plain HTTP (WebKit/Safari enforces this per-resource, breaking bundle.js
      // with no visible error beyond a stuck "Connecting..." screen). Never send it here.
      hsts: hostedHttps
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
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

  // S3 embedded-node: serve the prebuilt web SPA so the WebView/renderer can
  // reuse 100% of the browser UI from this local node (loopback origin).
  const embedded = resolveEmbeddedNodeConfig(process.env);

  // §19.2: www.iinpublic.com is a relay-only hub that also serves the static SPA
  // bundle — a plain browser tab is a first-class client, not just an app-download
  // landing page. Embedded shells (Electron/mobile) use their own configured
  // webRoot; the plain (non-embedded) relay/hub falls back to the standard
  // production build output, dist/web, when present (a bare `npm run dev` server
  // with no `build:web` run yet has no dist/web — falls through to public/ below,
  // same as before this route existed).
  const webRoot = embedded.enabled
    ? path.resolve(embedded.webRoot)
    : path.resolve(process.cwd(), 'dist', 'web');
  const servingSpa = fs.existsSync(path.join(webRoot, 'index.html'));
  if (servingSpa) {
    app.use(express.static(webRoot));
    app.get('/', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
    logger.info(
      { webRoot, embedded: embedded.enabled },
      embedded.enabled ? 'S3 embedded-node: serving web SPA from local node' : 'Relay hub: serving web SPA at /',
    );
    warnIfBuildIdsDrifted(webRoot);
  }

  // Register downloads before the broad static mount so stale installers cannot
  // be fetched directly by an old bookmarked URL.
  registerDownloadRoutes(app);
  app.use(express.static('public'));

  // worker.js imports Gun directly. Mount only that dependency instead of the
  // repository root: express.static('.') would otherwise publish source files,
  // package metadata, logs, and other deployment internals.
  const gunRoot = process.env.IINPUBLIC_NODE_MODULES_ROOT
    ? path.resolve(process.env.IINPUBLIC_NODE_MODULES_ROOT, 'gun')
    : path.resolve(process.cwd(), 'node_modules', 'gun');
  if (fs.existsSync(gunRoot)) {
    app.use('/node_modules/gun', express.static(gunRoot));
  } else {
    logger.warn({ gunRoot }, 'Gun browser assets are missing; /worker.js cannot initialize');
  }
  app.use((Gun as any).serve);

  if (embedded.enabled) {
    const publicRoot = process.env.IINPUBLIC_PUBLIC_ROOT
      ? path.resolve(process.env.IINPUBLIC_PUBLIC_ROOT)
      : path.resolve(webRoot, '..', '..', 'public');
    if (fs.existsSync(publicRoot)) {
      app.use(express.static(publicRoot));
      logger.info({ publicRoot }, 'S3 embedded-node: serving public assets from local node');
    } else {
      logger.warn({ publicRoot }, 'S3 embedded-node: public asset root missing; /worker.js may not load');
    }
  }
}

/**
 * Desktop autoupdate must ship dist/web and dist/server as one atomic unit
 * (see scripts/stamp-build-id.js). electron-builder packaging already makes
 * that true in the normal case, but this is the runtime safety net: if the
 * two build outputs ever disagree (partial copy, broken release artifact,
 * manual tinkering with an install dir), surface it loudly instead of
 * silently serving a UI that may not match this node's API/Gun-graph shape.
 * Intentionally non-fatal — a stale/missing stamp should not block the node
 * from starting, since older builds predate this check entirely.
 */
export function warnIfBuildIdsDrifted(webRoot: string): void {
  type BuildStamp = { buildId?: string; builtAt?: string };
  const readStamp = (p: string): BuildStamp | null => {
    try {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      return null;
    }
  };
  const webStamp = readStamp(path.join(webRoot, 'build-id.json'));
  // This file (compiled) lives at dist/server/server/bootstrap/http-bootstrap.js;
  // its build-id.json sibling is written to dist/server/server/build-id.json.
  const serverStamp = readStamp(path.join(__dirname, '..', 'build-id.json'));

  if (!webStamp || !serverStamp) {
    logger.warn(
      { hasWebStamp: !!webStamp, hasServerStamp: !!serverStamp },
      'S3 embedded-node: build-id stamp missing on one or both sides — cannot verify dist/web and dist/server were built together (run scripts/stamp-build-id.js, or rebuild with a version that includes it)',
    );
    return;
  }
  if (webStamp.buildId !== serverStamp.buildId) {
    logger.error(
      { webBuildId: webStamp.buildId, serverBuildId: serverStamp.buildId, webBuiltAt: webStamp.builtAt, serverBuiltAt: serverStamp.builtAt },
      'S3 embedded-node: dist/web and dist/server build-ids DO NOT MATCH — this install is serving a UI build that was not packaged with this node build. An autoupdate or release artifact may be corrupted/partial.',
    );
  } else {
    logger.info({ buildId: webStamp.buildId }, 'S3 embedded-node: dist/web and dist/server build-ids match');
  }
}

/**
 * P2P-Z: Warn at startup if a stale radata/ directory exists while the server
 * is configured as a relay-only hub (no application-layer persistence).
 * The directory is harmless but indicates a misconfigured deployment.
 */
export function warnIfStaleRadataExists(cwd = process.cwd()): void {
  const radataPath = path.join(cwd, 'radata');
  try {
    const stat = fs.statSync(radataPath);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(radataPath);
      logger.warn(
        { radataPath, fileCount: entries.length },
        'P2P-Z: relay-only hub has a stale radata/ directory — remove it from the container image to keep the hub stateless',
      );
    }
  } catch {
    // radata/ does not exist — expected in relay-only mode
  }
}

/**
 * Decide which upstream Gun peers an embedded local node should dial.
 *
 * Pulled out of `attachGun` so the decision is unit-testable without
 * constructing a real Gun instance (Gun() has heavy module-level/global side
 * effects — timers, websocket setup — that are awkward and flaky to exercise
 * directly in Jest; see src/test/unit/embedded-node-hub-dial.test.ts).
 *
 * BUG FIX (S3 embedded-node): this used to be gated on a generic
 * `isolatedGun` flag that also folded in `ephemeralStarServer`
 * (`resolveP2PRuntimeFlags().starServerPersistence === 'ephemeral'`, which is
 * hardcoded `true` for every boot since mesh talk delivery shipped — see
 * p2p-runtime.ts). That made `isolatedGun` unconditionally true, so embedded
 * nodes never actually dialed the hub at all, despite logging "embedded local
 * node" and the configured hub URL. The only flags that should suppress an
 * embedded node's hub dial are the EXPLICIT test/dev isolation switches
 * (E2E_GUN_MEMORY_ONLY, DEV_GUN_FRESH) — they exist so local dev/e2e runs
 * don't accidentally dial a real hub — not the always-on mesh-delivery flag.
 */
export function resolveUpstreamHubPeers(
  embedded: Pick<ReturnType<typeof resolveEmbeddedNodeConfig>, 'enabled' | 'hubGunPeers' | 'hubRelayMode'>,
  isolation: { e2eMemoryOnly: boolean; devGunFresh: boolean },
): string[] {
  const skipEmbeddedHubDial = isolation.e2eMemoryOnly || isolation.devGunFresh;
  if (!embedded.enabled || skipEmbeddedHubDial) return [];
  if (embedded.hubRelayMode === 'explicit-http') return [];
  return embedded.hubGunPeers;
}

export function attachGun(server: HttpServer): any {
  const e2eMemoryOnly =
    process.env.E2E_GUN_MEMORY_ONLY === '1' || process.env.E2E_GUN_MEMORY_ONLY === 'true';
  const devGunFresh = process.env.DEV_GUN_FRESH === '1';
  const p2pFlags = resolveP2PRuntimeFlags(process.env);
  const ephemeralStarServer = p2pFlags.starServerPersistence === 'ephemeral';
  const isolatedGun = e2eMemoryOnly || devGunFresh || ephemeralStarServer || p2pFlags.relayOnlyHub;

  // P2P-Z: warn about stale radata/ when running as relay-only hub
  if (p2pFlags.relayOnlyHub) {
    warnIfStaleRadataExists();
  }

  // S3 embedded-node mode: the native shells (Electron / nodejs-mobile) run
  // this same server as a *local* Gun peer that dials the public hub upstream
  // for discovery/signaling only, while persisting app data on-device.
  const embedded = resolveEmbeddedNodeConfig(process.env);
  const upstreamHubPeers = resolveUpstreamHubPeers(embedded, { e2eMemoryOnly, devGunFresh });

  const gun = Gun({
    web: server,
    localStorage: false,
    // Embedded nodes always persist on-device (Gun-on-device is source of truth).
    radisk: embedded.enabled ? true : !isolatedGun,
    ...(isolatedGun ? { peers: [], axe: false, multicast: false } : {}),
    ...(upstreamHubPeers.length > 0
      ? { peers: upstreamHubPeers, axe: false, multicast: false }
      : {}),
  });
  logger.info(
    {
      radisk: embedded.enabled ? true : !isolatedGun,
      devGunFresh,
      starServerPersistence: p2pFlags.starServerPersistence,
      relayOnlyHub: p2pFlags.relayOnlyHub,
      p2pNodeEnabled: p2pFlags.p2pNodeEnabled,
      embeddedNode: embedded.enabled,
      embeddedPlatform: embedded.enabled ? embedded.platform : undefined,
      upstreamHubPeers: upstreamHubPeers.length > 0 ? upstreamHubPeers : undefined,
    },
    embedded.enabled ? '🔫 Gun.js attached (embedded local node)' : '🔫 Gun.js attached to HTTP(S) server',
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
