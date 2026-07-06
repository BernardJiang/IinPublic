/**
 * Embedded local-node entry point (S3 cross-platform native clients).
 *
 * This is the single Node program that every native shell boots:
 *   - Electron desktop  → spawned from the main process (`platforms/desktop`).
 *   - Android / iOS      → started by nodejs-mobile inside the app sandbox
 *                          (`platforms/mobile/nodejs-project/main.js` requires
 *                          the compiled version of this file).
 *
 * It reuses `src/server` verbatim: the server boots in embedded mode (see
 * `resolveEmbeddedNodeConfig` + `attachGun`), persisting app data on-device and
 * dialing the public hub as an upstream Gun peer **for discovery only**, while
 * serving the prebuilt web SPA so the WebView/renderer reuses the browser UI.
 *
 * Environment knobs (all optional; shells inject host-specific values):
 *   IINPUBLIC_EMBEDDED_NODE=1      (forced on here)
 *   IINPUBLIC_PLATFORM=windows|ubuntu|macos|android|ios
 *   IINPUBLIC_HUB_GUN_URL=https://www.iinpublic.com/gun[,...]
 *   IINPUBLIC_EMBEDDED_HUB_MODE=explicit-http|gun-peer
 *   IINPUBLIC_LOCAL_PORT=8080
 *   IINPUBLIC_WEB_ROOT=/abs/path/to/dist/web
 *   IINPUBLIC_DATA_DIR=/abs/path/to/writable/app-data
 */

import fs from 'fs';
import path from 'path';
import {
  resolveEmbeddedNodeConfig,
  type EmbeddedNodeConfig,
} from '../shared/embedded-node-config';

export interface StartEmbeddedNodeOptions {
  /** Host-specific defaults injected by the native shell. */
  defaults?: Partial<EmbeddedNodeConfig>;
  /** When false, resolve config but do not start the server (tests). */
  start?: boolean;
}

export interface EmbeddedNodeHandle {
  config: EmbeddedNodeConfig;
  /** The underlying IinPublicServer instance, when started. */
  server?: unknown;
}

/**
 * Apply embedded defaults to process.env *before* the server module loads,
 * because `attachGun` / `configureHttpMiddleware` read env at construction.
 */
function applyEnv(config: EmbeddedNodeConfig): void {
  process.env.IINPUBLIC_EMBEDDED_NODE = '1';
  process.env.IINPUBLIC_PLATFORM = config.platform;
  process.env.IINPUBLIC_LOCAL_PORT = String(config.localPort);
  process.env.PORT = String(config.localPort);
  process.env.IINPUBLIC_WEB_ROOT = config.webRoot;
  process.env.IINPUBLIC_DATA_DIR = config.dataDir;
  process.env.IINPUBLIC_LOOPBACK_ONLY = config.loopbackOnly ? '1' : '0';
  process.env.IINPUBLIC_EMBEDDED_HUB_MODE = config.hubRelayMode;
  if (config.hubGunPeers.length > 0) {
    process.env.IINPUBLIC_HUB_GUN_URL = config.hubGunPeers.join(',');
  }
}

/** Ensure the on-device data dir exists and Gun radisk writes there. */
function prepareDataDir(config: EmbeddedNodeConfig): void {
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    // Gun's radisk defaults to <cwd>/radata; chdir so on-device persistence
    // lands in the app sandbox rather than a read-only bundle dir.
    process.chdir(config.dataDir);
  } catch (err) {
    // Non-fatal: fall back to cwd. Logged once the server logger is up.
    // eslint-disable-next-line no-console
    console.warn('[embedded-node] could not prepare data dir', config.dataDir, err);
  }
}

export async function startEmbeddedNode(
  options: StartEmbeddedNodeOptions = {},
): Promise<EmbeddedNodeHandle> {
  const config = resolveEmbeddedNodeConfig(process.env, {
    enabled: true,
    ...options.defaults,
  });

  applyEnv(config);

  if (options.start === false) {
    return { config };
  }

  prepareDataDir(config);

  // Import lazily and AFTER env is applied so the server reads embedded config.
  const serverModule = await import('../server/index');
  const ServerCtor =
    (serverModule as Record<string, unknown>).IinPublicServer ??
    (serverModule as Record<string, unknown>).default;

  if (typeof ServerCtor !== 'function') {
    throw new Error(
      'embedded-node: src/server/index did not export a constructable IinPublicServer',
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const server = new (ServerCtor as any)();
  // eslint-disable-next-line no-console
  console.log(
    `[embedded-node] starting on 127.0.0.1:${config.localPort} ` +
      `(platform=${config.platform}, hub=${config.hubGunPeers.join(',') || 'none'}, ` +
      `hubMode=${config.hubRelayMode}, ` +
      `dataDir=${config.dataDir})`,
  );
  if (typeof server.start === 'function') {
    server.start(config.localPort);
  }

  return { config, server };
}

/** Resolve the default web root relative to this compiled file's location. */
export function defaultWebRoot(fromDir: string): string {
  // dist/server/node-app/embedded-node.js → repo dist/web
  return path.resolve(fromDir, '..', '..', 'web');
}

// Allow direct execution: `node dist/server/node-app/embedded-node.js`
// or `tsx src/node-app/embedded-node.ts`.
const isDirectRun =
  typeof require !== 'undefined' &&
  typeof module !== 'undefined' &&
  require.main === module;

if (isDirectRun) {
  startEmbeddedNode().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[embedded-node] fatal', err);
    process.exit(1);
  });
}
