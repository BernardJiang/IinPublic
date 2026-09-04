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

export interface TransientRadataQuarantineResult {
  movedFiles: number;
  movedBytes: number;
  quarantineDir?: string;
}

function isTransientSignalRadataFile(fileName: string): boolean {
  let decoded = fileName;
  try {
    decoded = decodeURIComponent(fileName);
  } catch {
    // A malformed unrelated filename is not a signaling record.
  }
  return decoded.startsWith('p2p-signal/') || decoded.startsWith('undefinedp2p-signal');
}

/**
 * Older embedded builds allowed peer-originated Gun signaling frames to pass
 * around the server persistence wrapper and land in Radisk. Those frames are
 * ephemeral transport data, but an established Android profile can contain
 * thousands of them and hydrate hundreds of MiB into V8.
 *
 * Move only recognizable signaling chunks out of the live Radisk directory
 * before Gun starts. A timestamped quarantine keeps the migration recoverable;
 * identity, Talk, contact, and key-custody records are never selected.
 */
export function quarantineTransientSignalRadata(
  dataDir: string,
  now = Date.now(),
): TransientRadataQuarantineResult {
  const radataDir = path.join(dataDir, 'radata');
  let candidates: fs.Dirent[];
  try {
    candidates = fs
      .readdirSync(radataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && isTransientSignalRadataFile(entry.name));
  } catch {
    return { movedFiles: 0, movedBytes: 0 };
  }
  if (candidates.length === 0) return { movedFiles: 0, movedBytes: 0 };

  const quarantineDir = path.join(
    dataDir,
    'radata-transient-quarantine',
    `signal-${now}-${process.pid}`,
  );
  fs.mkdirSync(quarantineDir, { recursive: true });

  let movedFiles = 0;
  let movedBytes = 0;
  for (const entry of candidates) {
    const source = path.join(radataDir, entry.name);
    const destination = path.join(quarantineDir, entry.name);
    try {
      const bytes = fs.statSync(source).size;
      fs.renameSync(source, destination);
      movedFiles += 1;
      movedBytes += bytes;
    } catch {
      // Leave an individual file in place if it races or cannot be moved; a
      // later boot can retry without blocking the native app from starting.
    }
  }

  return { movedFiles, movedBytes, quarantineDir };
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
    const quarantine = quarantineTransientSignalRadata(config.dataDir);
    if (quarantine.movedFiles > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[embedded-node] quarantined ${quarantine.movedFiles} transient Gun signaling files ` +
          `(${quarantine.movedBytes} bytes) at ${quarantine.quarantineDir}`,
      );
    }
    // Gun's radisk defaults to <cwd>/radata; chdir so on-device persistence
    // lands in the app sandbox rather than a read-only bundle dir.
    process.chdir(config.dataDir);
  } catch (err) {
    // Non-fatal: fall back to cwd. Logged once the server logger is up.
    // eslint-disable-next-line no-console
    console.warn('[embedded-node] could not prepare data dir', config.dataDir, err);
  }
}

/**
 * Gun's own on-disk radix-tree index (node_modules/gun/lib/radix.js, used by Radisk) has a
 * known internals bug: a leaf that was compressed to hold a raw primitive (a bare timestamp
 * number) instead of an object throws `TypeError: Cannot create property '<field>' on number
 * '<timestamp>'` the moment ANY later write tries to set a field at that same tree position —
 * observed live, 2026-09-04, crashing three phones on every single boot (SIGABRT inside
 * libnode.so) regardless of which field triggered it (`stalePresenceExpired`, then `isActive`
 * once that first write was avoided — the corrupted leaf, not the field name, is the trigger).
 * This is the production relay's near-total blind spot for this bug: it runs permanently
 * ephemeral (radisk:false, p2p-runtime.ts) so Radisk's disk-index code never actually executes
 * there. Only embedded nodes (real on-device persistence, so they can work offline) hit it.
 *
 * There is no reliable way to know in advance which key will be corrupted, or to distinguish
 * "safe to keep going" from a genuinely fatal error — but crashing this process on every launch
 * is strictly worse for a phone the user depends on. Swallow only this exact, recognizable
 * Gun-internals error class and keep the process alive; anything else still crashes normally.
 */
function isKnownRadiskCorruption(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  // Observed values include a fractional HAM tie-breaker suffix (e.g. '...789.003'), not just
  // a bare integer timestamp.
  if (!/^Cannot create property '.*' on number '[\d.]+'$/.test(err.message)) return false;
  const stack = err.stack || '';
  return /[/\\]gun[/\\]lib[/\\]radix2?\.js/.test(stack) || /\bat radix\b/.test(stack);
}

/**
 * rfs.js (Gun's default Radisk filesystem store) writes one file per Gun key under
 * <dataDir>/radata/, plus a single aggregate root index file at <dataDir>/radata/! (Radisk's
 * `opt.code.from` default) that merges every key's radix branch into one tree on load — see
 * gun/lib/radisk.js. The corruption reproduces from a completely empty store within seconds of
 * a fresh boot, so it's the merge step (many branches sharing one tree) that trips gun/lib/
 * radix.js's leaf-vs-branch compression bug, not any single per-key file's own content.
 * Deleting only that one aggregate file forces Radisk to rebuild it by re-scanning the
 * (unaffected) per-key files on the next boot — recovering everything except whatever the
 * corrupted merge itself was in the middle of, instead of a full-store wipe.
 */
function quarantineRadiskRootIndex(dataDir: string): void {
  const rootIndexPath = path.join(dataDir, 'radata', '!');
  try {
    if (!fs.existsSync(rootIndexPath)) return;
    const quarantineDir = path.join(dataDir, 'radata-transient-quarantine', `root-index-${Date.now()}`);
    fs.mkdirSync(quarantineDir, { recursive: true });
    fs.renameSync(rootIndexPath, path.join(quarantineDir, '!'));
    // eslint-disable-next-line no-console
    console.error(`[embedded-node] quarantined corrupted Radisk root index at ${rootIndexPath} -> ${quarantineDir}; it will rebuild from the surviving per-key files on next boot`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[embedded-node] failed to quarantine Radisk root index (non-fatal, process stays up)', err);
  }
}

/**
 * Gun's own on-disk radix-tree index (node_modules/gun/lib/radix.js, used by Radisk) has a
 * known internals bug: a leaf that was compressed to hold a raw primitive (a bare timestamp
 * number) instead of an object throws `TypeError: Cannot create property '<field>' on number
 * '<timestamp>'` the moment ANY later operation touches that same tree position — observed
 * live, 2026-09-04: it crashed three phones on every boot (SIGABRT inside libnode.so) via a
 * write, and separately surfaced during a `.map()` *read* (store.js's own Radix.map call),
 * where Gun's own internal try/catch silently swallows it and skips that data — i.e. this bug
 * can also cause silent data loss (an incoming broadcast never showing up) with no crash at all.
 * This is the production relay's near-total blind spot for this bug: it runs permanently
 * ephemeral (radisk:false, p2p-runtime.ts) so Radisk's disk-index code never executes there.
 * Only embedded nodes (real on-device persistence, so they can work offline) hit it.
 *
 * Disabling on-device persistence entirely would dodge this, but a production app silently
 * losing all local data across every reboot is a worse defect than the one being fixed.
 * Instead: swallow only this exact, recognizable error (anything else still crashes normally —
 * this is not a general crash suppressor), and on each occurrence quarantine just the
 * rebuildable aggregate root index (see quarantineRadiskRootIndex) rather than the whole store,
 * so the next boot self-heals with minimal data loss instead of repeating the same crash.
 */
function installRadiskCorruptionGuard(dataDir: string): void {
  process.on('uncaughtException', (err) => {
    if (isKnownRadiskCorruption(err)) {
      // eslint-disable-next-line no-console
      console.error('[embedded-node] swallowed known Gun/Radisk radix-tree corruption (see installRadiskCorruptionGuard doc comment):', err);
      quarantineRadiskRootIndex(dataDir);
      return;
    }
    throw err;
  });
}

export async function startEmbeddedNode(
  options: StartEmbeddedNodeOptions = {},
): Promise<EmbeddedNodeHandle> {
  const config = resolveEmbeddedNodeConfig(process.env, {
    enabled: true,
    ...options.defaults,
  });
  installRadiskCorruptionGuard(config.dataDir);

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
