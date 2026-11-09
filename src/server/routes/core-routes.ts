/**
 * The device core hosted by the embedded node (OPEN-91 P5): the same `src/core/` handler the web
 * worker runs, over this node's own Gun (radisk on disk), answered on loopback to the app's own
 * WebView. Any other app on the device can reach a loopback port, so a request must carry the
 * shell's per-install secret (`IINPUBLIC_CORE_TOKEN`, or the background agent's on Android, which
 * the shell already passes in); without it the route does not exist (404).
 */
import fs from 'fs';
import path from 'path';
import type express from 'express';

/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto';
import { createCoreHandler } from '../../core/core-handler';
import { gunNodeStore } from '../../core/device-graph/node-store';
import { seaGraphCrypto } from '../../core/device-graph/sync/sea-crypto';
import SEA from 'gun/sea';
import Radisk from 'gun/lib/radisk';
import { gunGraphStore } from '../../core/graph-store';
import type { CoreRequest } from '../../core/protocol';
import { soulLeavesDevice } from '../../core/sharing-policy';

export function localNodeToken(env: NodeJS.ProcessEnv): string {
  const token = String(env.IINPUBLIC_CORE_TOKEN || env.IINPUBLIC_BACKGROUND_AGENT_TOKEN || '');
  return token.length >= 32 ? token : '';
}

/** Bytes in a folder (the radata store), for the device graph's 1 GB limit. */
async function directoryBytes(dir: string): Promise<number | undefined> {
  try {
    let total = 0;
    for (const entry of await fs.promises.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += (await directoryBytes(full)) ?? 0;
      else total += (await fs.promises.stat(full)).size;
    }
    return total;
  } catch {
    return undefined;
  }
}

/** Longer than radisk's write batch (`until`, 250 ms), so a test wipe never races a queued write. */
const RADISK_FLUSH_WAIT_MS = 1000;

/** A node whose Gun has never stored anything (no radata yet): snapshots are empty until a write. */
function freshDataDir(dataDir: string): boolean {
  try {
    return fs.readdirSync(path.join(dataDir, 'radata')).length === 0;
  } catch {
    return true;
  }
}

/**
 * Forgets the device's own records in this Gun's memory. Emptying `gun._.graph` is not enough: each
 * soul's chain keeps its last value (`gun._.next[soul]`) and answers reads from it.
 */
function forgetDeviceSouls(gun: any): void {
  const next = gun?._?.next;
  if (!next || typeof next !== 'object') return;
  for (const soul of Object.keys(next)) if (!soulLeavesDevice(soul)) delete next[soul];
}

/** The node's device core. `resetForTesting` is a wiped device (e2e clear-database). */
export function registerCoreRoutes(app: express.Application, gun: unknown, token: string, dataDir: string): { resetForTesting: () => Promise<void> } {
  // The node's disk is its Gun's only storage: a miss it reports is final (no cold-load grace).
  const store = () => gunGraphStore(gun, { missWaitMs: 0 });
  const allowTestOverrides = process.env.E2E_GUN_MEMORY_ONLY === '1';
  const randomBytes = (length: number) => new Uint8Array(crypto.randomBytes(length));
  const radata = path.join(dataDir, 'radata');
  const deviceGraph = () => ({
    nodeStore: gunNodeStore(gun, { missWaitMs: 0 }),
    randomBytes,
    log: (message: string) => console.warn(message),
    // OPEN-106 step 3: direct links carry the graph through this Gun.
    gun,
    crypto: seaGraphCrypto(SEA, randomBytes),
    storageUsage: async () => directoryBytes(radata),
  });
  let handle = createCoreHandler(store(), { freshDevice: freshDataDir(dataDir), allowTestOverrides, deviceGraph: deviceGraph() });
  const authorized = (req: express.Request): boolean => token.length >= 32 && req.get('authorization') === `Bearer ${token}`;

  app.post('/api/core', async (req, res) => {
    if (!authorized(req)) {
      res.status(404).end();
      return;
    }
    try {
      res.json({ ok: true, value: await handle(req.body?.request as CoreRequest) });
    } catch (error) {
      res.status(400).json({ ok: false, error: (error as Error).message });
    }
  });

  // OPEN-106 on a phone (adb forward, loopback only, not in production builds): GET the counts of
  // my Talks written into the device graph.
  if (process.env.NODE_ENV !== 'production') {
    const loopback = (req: express.Request) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(req.socket.remoteAddress || ''));
    app.get('/api/debug/device-graph', async (req, res) => {
      if (!loopback(req)) { res.status(403).end(); return; }
      res.json(await handle({ name: 'deviceGraph.status' }));
    });
  }

  return {
    resetForTesting: async () => {
      // A wiped device has nothing in storage either. Left there, the previous user's device id,
      // chain head and events were read back by the next user's core, whose chain then failed its
      // signature check at seq 0 (phone-path 12 after any spec on the same phone). Three places hold
      // them: Gun's memory, radisk's write queue and parsed-file cache, and this node's radata
      // (under its data dir, which the hub's clear of radata under cwd may not reach).
      forgetDeviceSouls(gun);
      // Writes still queued when the files go would recreate them: let radisk flush first
      // (it batches for `until`, 250 ms by default).
      await new Promise((resolve) => setTimeout(resolve, RADISK_FLUSH_WAIT_MS));
      if (fs.existsSync(dataDir)) {
        fs.rmSync(radata, { recursive: true, force: true });
        fs.mkdirSync(radata, { recursive: true });
      }
      const rad = (Radisk as any).has?.[String((gun as any)?._?.opt?.file ?? 'radata')];
      if (rad) rad.disk = {};
      forgetDeviceSouls(gun);
      handle = createCoreHandler(store(), { freshDevice: true, allowTestOverrides, deviceGraph: deviceGraph() });
    },
  };
}
