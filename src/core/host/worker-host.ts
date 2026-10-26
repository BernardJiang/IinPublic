/**
 * The device core's web host (OPEN-91): a Web Worker that runs the device's Gun instance — peerless,
 * persisted to IndexedDB — and the core logic in `src/core/`, serving the page over `postMessage`.
 * Replaces the hand-written `public/worker.js`, keeping its message types for `GunBridge`
 * (`{ id, type, payload }` in, `{ id, err, data }` and `{ type: 'subscription', … }` out) and adding
 * `type: 'core'` for core requests. The native host will run the same core in Node.js.
 *
 * Loaded via `new Worker('/core-worker.js')` (webpack entry `core-worker`).
 */
import { gunGraphStore } from '../graph-store';
import { createCoreHandler } from '../core-handler';
import type { CoreRequest } from '../protocol';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function importScripts(...urls: string[]): void;
const scope = self as any;

/* ── 1. Load Gun + SEA ──────────────────────────────────────────────────────
 * gun.js registers window.Gun only when `window` exists; in a worker alias it to `self` first, or
 * sea.js falls into its require('./gun') path and throws. Gun's IndexedDB persistence is the
 * radix → radisk → store plugin chain (order matters); without it `store:` is silently ignored and
 * nothing is persisted (found by e2e 37-hard-crash-recovery). */
if (typeof scope.window === 'undefined') scope.window = scope;
importScripts('/node_modules/gun/gun.js');
importScripts('/node_modules/gun/lib/radix.js');
importScripts('/node_modules/gun/lib/radisk.js');
importScripts('/node_modules/gun/lib/store.js');
importScripts('/node_modules/gun/sea.js');
const Gun = scope.Gun;
const SEA = scope.SEA;

/* ── 2. IndexedDB persistence ─────────────────────────────────────────────── */
const IDB_NAME = 'gun-idb';
const IDB_STORE = 'nodes';
let database: IDBDatabase | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => { database = request.result; resolve(request.result); };
    request.onerror = () => reject(request.error);
  });
}

const idbAdapter = {
  put(key: string, data: unknown, cb: (err: unknown, data?: unknown) => void): void {
    openDatabase().then((db) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(data, key);
      tx.oncomplete = () => cb(null, data);
      tx.onerror = () => cb(tx.error);
    }).catch((err) => cb(err));
  },
  get(key: string, cb: (err: unknown, data?: unknown) => void): void {
    openDatabase().then((db) => {
      const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key);
      request.onsuccess = () => cb(null, request.result !== undefined ? request.result : null);
      request.onerror = () => cb(request.error);
    }).catch((err) => cb(err));
  },
};

/* ── 3. The device's Gun ──────────────────────────────────────────────────────
 * Peerless: everything here stays on the device (docs/design/data-sharing-privacy-rules.md).
 * `radisk: false` must NOT be set — store.js's create hook no-ops on it. */
let gun: any = null;
let handleCore: ((request: CoreRequest) => Promise<unknown>) | null = null;

function initGun(): void {
  if (gun) return;
  gun = Gun({ peers: [], localStorage: false, store: idbAdapter });
  // Ready once storage is open: the GUI's first read (the exchange log at start-up) must find the
  // device's data, not an empty graph that has not loaded yet. An empty store means a new device.
  openDatabase()
    .then((db) => new Promise<boolean>((resolve) => {
      const request = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).count();
      request.onsuccess = () => resolve(request.result === 0);
      request.onerror = () => resolve(false);
    }))
    .catch(() => false)
    .then((freshDevice) => {
      handleCore = createCoreHandler(gunGraphStore(gun), { freshDevice });
      scope.postMessage({ type: 'ready' });
    });
}

/* ── 4. Session and subscriptions ─────────────────────────────────────────── */
let currentUser: { pair: any } | null = null;
const subscriptions = new Map<string, any>();

function pathRef(path: string): any {
  const parts = path.split('/').filter(Boolean);
  let ref = gun.get(parts[0]);
  for (let i = 1; i < parts.length; i++) ref = ref.get(parts[i]);
  return ref;
}

function gunPut(path: string, data: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // A peerless instance has the write the moment .put() runs; a missing ack is not a failure.
    const timeout = setTimeout(() => resolve({ ok: true, timedOut: true }), 8000);
    pathRef(path).put(data, (ack: any) => {
      clearTimeout(timeout);
      if (ack.err) reject(new Error(ack.err));
      else resolve(ack);
    });
  });
}

function gunGet(path: string): Promise<unknown> {
  return new Promise((resolve) => {
    let done = false;
    const timeout = setTimeout(() => { if (!done) { done = true; resolve(null); } }, 6000);
    pathRef(path).once((data: unknown) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      resolve(data !== undefined ? data : null);
    });
  });
}

function reply(id: number, err: string | null, data: unknown): void {
  scope.postMessage({ id, err: err || null, data: data !== undefined ? data : null });
}

/* ── 5. Messages from the page ────────────────────────────────────────────── */
scope.onmessage = async (event: MessageEvent) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type !== 'init' && !gun) initGun();
    switch (type) {
      case 'init':
        initGun();
        reply(id, null, { ok: true });
        break;
      case 'core':
        if (!handleCore) throw new Error('device core not ready');
        reply(id, null, await handleCore(payload as CoreRequest));
        break;
      case 'put':
        await gunPut(payload.path, payload.data);
        reply(id, null, { ok: true });
        break;
      case 'get':
        reply(id, null, await gunGet(payload.path));
        break;
      case 'subscribe': {
        const handler = pathRef(payload.path).on((data: unknown, key: string) => {
          scope.postMessage({ type: 'subscription', subId: payload.subId, data, key });
        });
        subscriptions.set(payload.subId, handler);
        reply(id, null, { ok: true });
        break;
      }
      case 'unsubscribe': {
        const handler = subscriptions.get(payload.subId);
        if (handler && typeof handler.off === 'function') handler.off();
        subscriptions.delete(payload.subId);
        reply(id, null, { ok: true });
        break;
      }
      case 'createAccount': {
        const pair = await SEA.pair();
        currentUser = { pair };
        reply(id, null, { pub: pair.pub, epub: pair.epub });
        break;
      }
      case 'login':
        currentUser = { pair: payload.pair };
        reply(id, null, { pub: payload.pair.pub, epub: payload.pair.epub });
        break;
      case 'logout':
        currentUser = null;
        reply(id, null, { ok: true });
        break;
      case 'putPublic':
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        await gunPut(`users/${currentUser.pair.pub}/public/${payload.key}`, payload.data);
        reply(id, null, { ok: true });
        break;
      case 'putPrivate': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const encrypted = await SEA.encrypt(JSON.stringify(payload.data), currentUser.pair);
        await gunPut(`users/${currentUser.pair.pub}/private/${payload.key}`, encrypted);
        reply(id, null, { ok: true });
        break;
      }
      case 'getPrivate': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const raw = await gunGet(`users/${currentUser.pair.pub}/private/${payload.key}`);
        if (!raw) { reply(id, null, null); break; }
        const decrypted = await SEA.decrypt(raw, currentUser.pair);
        if (!decrypted) { reply(id, null, null); break; }
        reply(id, null, typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted);
        break;
      }
      case 'subscribePrivate': {
        if (!currentUser) { reply(id, 'Not logged in', null); break; }
        const user = currentUser;
        const handler = pathRef(`users/${user.pair.pub}/private/${payload.key}`).on(async (raw: unknown) => {
          if (!raw) return;
          try {
            const decrypted = await SEA.decrypt(raw, user.pair);
            if (!decrypted) return;
            scope.postMessage({ type: 'subscription', subId: payload.subId, data: typeof decrypted === 'string' ? JSON.parse(decrypted) : decrypted });
          } catch {
            // A corrupt local record is skipped; a later valid update remains subscribed.
          }
        });
        subscriptions.set(payload.subId, handler);
        reply(id, null, { ok: true });
        break;
      }
      case 'createNode':
        await gunPut(`nodes/${payload.nodeId}`, { ...payload.nodeData, id: payload.nodeId, createdAt: Date.now() });
        reply(id, null, { ok: true, nodeId: payload.nodeId });
        break;
      case 'linkNodes': {
        const label = payload.edgeLabel || 'link';
        await gunPut(`edges/${payload.fromId}/${label}/${payload.toId}`, { from: payload.fromId, to: payload.toId, label, at: Date.now() });
        reply(id, null, { ok: true });
        break;
      }
      default:
        reply(id, `Unknown message type: ${type}`, null);
    }
  } catch (err) {
    reply(id, err && (err as Error).message ? (err as Error).message : String(err), null);
  }
};
